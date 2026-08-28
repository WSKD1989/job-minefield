// AI 综合评分：聚合公司资料后调用 DeepSeek（OpenAI 兼容）接口评分

use serde_json::json;

use crate::models::{CompanyDetail, ScoreResult};

const DEFAULT_BASE_URL: &str = "https://api.deepseek.com";
const DEFAULT_MODEL: &str = "deepseek-chat";

/// 常见浏览器 UA，用于抓取企业信息站点
const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/// 聚合公司资料并请求 DeepSeek 给出综合评分
pub async fn request_score(
    detail: &CompanyDetail,
    api_key: &str,
    base_url: &str,
    model: &str,
) -> Result<ScoreResult, String> {
    let base = if base_url.trim().is_empty() {
        DEFAULT_BASE_URL.to_string()
    } else {
        base_url.trim().trim_end_matches('/').to_string()
    };
    let url = format!("{}/chat/completions", base);
    let model = if model.trim().is_empty() {
        DEFAULT_MODEL.to_string()
    } else {
        model.trim().to_string()
    };

    let user_content = build_prompt(detail);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let resp = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "temperature": 0.3,
            "response_format": { "type": "json_object" },
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content}
            ]
        }))
        .send()
        .await
        .map_err(|e| format!("请求 DeepSeek 失败: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?;

    if !status.is_success() {
        return Err(format!("DeepSeek 返回错误状态 {status}: {text}"));
    }

    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("解析响应 JSON 失败: {e}"))?;
    let content = v["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| format!("响应缺少内容字段: {text}"))?;

    let out: serde_json::Value =
        serde_json::from_str(content).map_err(|e| format!("AI 返回非 JSON: {e}"))?;

    let score = out["score"].as_i64().unwrap_or(0).clamp(0, 100);
    let summary = out["summary"].as_str().unwrap_or_default().to_string();
    let risk_level = out["risk_level"].as_str().unwrap_or("未知").to_string();
    let detail_text = out["detail"].as_str().unwrap_or_default().to_string();

    if summary.is_empty() {
        return Err(format!("AI 返回内容不完整: {content}"));
    }

    Ok(ScoreResult {
        company_id: detail.company.id,
        score,
        summary,
        risk_level,
        detail: detail_text,
    })
}

const SYSTEM_PROMPT: &str = r#"你是一位资深的求职风险评估顾问，擅长识别招聘骗局与"避坑"要点。
请根据应聘者提供的公司资料、岗位薪资、沟通对话等，客观地给出综合评估意见。
要求：
- score: 0-100 的整数综合评分（越高越值得去、越可靠）。
- risk_level: 只能是"低/中/高/极高"之一。
- summary: 一句话简明结论（≤60字）。
- detail: 详细评估理由（200字以内），指出优点与风险点；若是外包/外派/乙方，请指出其利弊。
- 只输出 JSON 对象，不要输出任何多余内容。"#;

fn build_prompt(detail: &CompanyDetail) -> String {
    let c = &detail.company;
    let positions: Vec<String> = detail
        .positions
        .iter()
        .map(|p| {
            format!(
                "{}(薪资 {}-{}，{}，{}，对接HR/联系人 {}: {})",
                p.title,
                p.salary_min.clone().unwrap_or_default(),
                p.salary_max.clone().unwrap_or_default(),
                p.location.clone().unwrap_or_default(),
                p.work_type.clone().unwrap_or_default(),
                p.hr_contact.clone().unwrap_or_default(),
                p.note.clone().unwrap_or_default()
            )
        })
        .collect();
    let chats_summary = {
        let total = detail.chats.len();
        let last: String = detail
            .chats
            .iter()
            .rev()
            .take(8)
            .map(|m| {
                let who = m
                    .contact
                    .clone()
                    .map(|c| format!("{}@{}", c, m.role))
                    .unwrap_or_else(|| m.role.clone());
                format!("[{who}] {}", m.content)
            })
            .collect::<Vec<_>>()
            .join("\n");
        format!("对话共 {total} 条，最近内容：\n{last}")
    };

    json!({
        "公司名称": c.name,
        "所属行业": c.industry,
        "公司简介": c.description,
        "网站": c.website,
        "公司地址": c.address,
        "联系人/HR": c.contact,
        "已标注风险": c.risk_note,
        "在职岗位": positions,
        "已投递次数": detail.apply_count,
        "标签": detail.tags,
        "沟通对话": chats_summary
    })
    .to_string()
}

// ================= 岗位 URL 读取与 AI 解析录入 =================

/// 用系统无头浏览器（Chrome/Edge）渲染抓取 URL，返回纯文本。适合需要 JS 渲染或简单反爬的招聘站点。
pub async fn render_url_text(url: &str) -> Result<String, String> {
    let browser = find_browser().ok_or_else(|| {
        "未找到 Chrome/Edge 浏览器，无法进行渲染抓取".to_string()
    })?;
    let html = tokio::task::spawn_blocking({
        let url = url.to_string();
        move || dump_dom(&browser, &url)
    })
    .await
    .map_err(|e| format!("渲染线程错误: {e}"))??;
    Ok(strip_html(&html).chars().take(12000).collect())
}

/// 在常见路径中查找 Chrome/Edge
fn find_browser() -> Option<String> {
    let candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "chrome",
        "msedge",
        "google-chrome",
        "chromium",
    ];
    for c in candidates {
        if let Ok(out) = std::process::Command::new(c).arg("--version").stderr(std::process::Stdio::null()).stdout(std::process::Stdio::null()).output() {
            if out.status.success() {
                return Some(c.to_string());
            }
        }
    }
    None
}

/// 调用无头浏览器 dump-dom 抓取渲染后 HTML（Windows 下隐藏控制台窗口）。
/// 用临时文件承接输出并用轮询超时强杀，避免 Chrome 卡死不退出导致一直转圈。
fn dump_dom(browser: &str, url: &str) -> Result<String, String> {
    use std::os::windows::process::CommandExt as _;
    use std::process::{Command};
    use std::time::{Duration, Instant};

    // 临时文件承接 stdout/stderr，避免管道写满阻塞
    let pid = std::process::id();
    let dir = std::env::temp_dir();
    let out_path = dir.join(format!("ykp_render_{pid}.html"));
    let err_path = dir.join(format!("ykp_render_{pid}.err"));
    let _ = std::fs::remove_file(&out_path);
    let _ = std::fs::remove_file(&err_path);
    let out_f = std::fs::File::create(&out_path).map_err(|e| format!("创建临时文件失败: {e}"))?;
    let err_f = std::fs::File::create(&err_path).map_err(|e| format!("创建临时文件失败: {e}"))?;
    let ua = format!("--user-agent={BROWSER_UA}");
    // 使用独立临时用户目录：防止与用户已开启的 Chrome 共用默认 profile 而被"接管"（页面参数失效）
    let profile = dir.join(format!("ykp_chrome_{pid}"));
    let userdata = format!("--user-data-dir={}", profile.display());

    let mut child = Command::new(browser)
        .args([
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--no-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--lang=zh-CN",
            ua.as_str(),
            userdata.as_str(),
            "--window-size=1280,900",
            "--virtual-time-budget=20000",
            "--dump-dom",
            url,
        ])
        .stdout(out_f)
        .stderr(err_f)
        // Windows 下不弹出控制台
        .creation_flags(0x0800_0000)
        .spawn()
        .map_err(|e| format!("启动无头浏览器失败: {e}"))?;

    // 轮询等待退出，45 秒超时则强杀
    let start = Instant::now();
    loop {
        match child.try_wait().map_err(|e| format!("等待浏览器失败: {e}"))? {
            Some(_) => break,
            None => {
                if start.elapsed() > Duration::from_secs(45) {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = std::fs::remove_file(&out_path);
                    let _ = std::fs::remove_file(&err_path);
                    return Err("无头浏览器抓取超时（45s），已终止。".into());
                }
                std::thread::sleep(Duration::from_millis(400));
            }
        }
    }

    let html = std::fs::read_to_string(&out_path).unwrap_or_default();
    let err = std::fs::read_to_string(&err_path).unwrap_or_default();
    let _ = std::fs::remove_file(&out_path);
    let _ = std::fs::remove_file(&err_path);
    let _ = std::fs::remove_dir_all(&profile);
    if html.trim().is_empty() {
        return Err(format!("无头浏览器抓取失败: {}", err.trim()));
    }
    Ok(html)
}

/// 抓取 URL 网页并转为可读文本（去除脚本样式与标签）。
/// 部分招聘站点需要登录或反爬，抓取失败时前端回退到"粘贴文本"由 AI 解析。
pub async fn fetch_url_text(url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent(BROWSER_UA)
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("抓取失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("抓取失败，HTTP {}", resp.status()));
    }
    let html = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?;
    let text = strip_html(&html);
    // 截断避免过大输入
    Ok(text.chars().take(12000).collect())
}

/// 简易 HTML -> 文本，够用于交给 AI 解析
fn strip_html(html: &str) -> String {
    let lower = html.to_lowercase();
    let mut buf = String::with_capacity(html.len());
    let mut in_script: i32 = 0;
    let mut chars = html.char_indices();
    while let Some((_i, ch)) = chars.next() {
        // 跳过 script/style 内容
        if ch == '<' {
            let rest_start = html.is_char_boundary(_i + ch.len_utf8())
                .then(|| _i + ch.len_utf8())
                .unwrap_or(_i);
            let rest = &lower[rest_start.min(lower.len())..];
            if rest.starts_with("script") || rest.starts_with("style") {
                in_script += 1;
            } else if rest.starts_with("/script") || rest.starts_with("/style") {
                in_script = in_script.saturating_sub(1);
            } else if in_script > 0 {
                // 在 script 内，跳过当前字符
                continue;
            } else {
                // 其它标签；块级闭合标签给换行分隔
                if rest.starts_with('/') || rest.starts_with("br") || rest.starts_with("p ")
                    || rest.starts_with("li") || rest.starts_with("div") || rest.starts_with("h")
                    || rest.starts_with("tr") || rest.starts_with("td") {
                    buf.push('\n');
                }
                // 跳过标签主体
                while let Some((_, c)) = chars.next() {
                    if c == '>' {
                        break;
                    }
                }
                continue;
            }
            continue;
        }
        if in_script > 0 {
            continue;
        }
        buf.push(ch);
    }
    let mut out = String::new();
    let mut prev_space = false;
    for ch in buf.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                out.push(' ');
            }
            prev_space = true;
        } else {
            out.push(ch);
            prev_space = false;
        }
    }
    out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
}

/// 调用 DeepSeek 从招聘文本（URL 抓取正文或粘贴的 JD）解析岗位字段
pub async fn parse_job(
    text: &str,
    api_key: &str,
    base_url: &str,
    model: &str,
) -> Result<serde_json::Value, String> {
    let base = if base_url.trim().is_empty() {
        DEFAULT_BASE_URL.to_string()
    } else {
        base_url.trim().trim_end_matches('/').to_string()
    };
    let url = format!("{}/chat/completions", base);
    let model = if model.trim().is_empty() {
        DEFAULT_MODEL.to_string()
    } else {
        model.trim().to_string()
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let system = "你是招聘信息结构化助手。从招聘文案中提取以下字段，只输出 JSON 对象，不要任何多余内容，缺失的字段用空字符串：\
    {\"title\":\"岗位名称\",\"salary_min\":\"下限\",\"salary_max\":\"上限\",\"salary_note\":\"薪资说明(含绩效/五险一金/补贴)\",\
    \"location\":\"工作地点\",\"work_type\":\"onsite|remote|hybrid 之一\",\"hr_contact\":\"对接HR/联系人(若未给出则为空)\",\"note\":\"岗位职责与要求摘要(≤120字)\"}";
    let user = json!({"招聘文本": text}).to_string();

    let resp = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "temperature": 0.2,
            "response_format": { "type": "json_object" },
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user}
            ]
        }))
        .send()
        .await
        .map_err(|e| format!("请求 DeepSeek 失败: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {e}"))?;
    if !status.is_success() {
        return Err(format!("AI 返回错误状态 {status}: {text}"));
    }

    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("解析响应 JSON 失败: {e}"))?;
    let content = v["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| format!("响应缺少内容字段: {text}"))?;
    let parsed: serde_json::Value =
        serde_json::from_str(content).map_err(|e| format!("AI 未返回有效 JSON: {e}"))?;
    Ok(parsed)
}

// ================= 爱企查工商信息 =================

/// 抓取爱企查搜索页并转为文本，交 AI 抽取企业工商信息。
/// 爱企查需登录/有反爬，抓取可能受限；失败时前端会提示。
pub async fn fetch_aiqicha(query: &str) -> Result<String, String> {
    use reqwest::header::{HeaderMap, HeaderValue, REFERER, USER_AGENT};
    use url::Url;
    let url = Url::parse_with_params("https://aiqicha.baidu.com/s", &[("q", query)])
        .map_err(|e| format!("构造链接失败: {e}"))?;
    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"),
    );
    headers.insert(REFERER, HeaderValue::from_static("https://aiqicha.baidu.com/"));
    let client = reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    let resp = client
        .get(url)
        .header("Accept", "text/html,application/xhtml+xml,*/*")
        .send()
        .await
        .map_err(|e| format!("抓取爱企查失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("抓取爱企查失败，HTTP {}", resp.status()));
    }
    let html = resp.text().await.map_err(|e| format!("读取响应失败: {e}"))?;
    Ok(strip_html(&html).chars().take(6000).collect())
}

/// 站点感知抓取：按域名（爱企查 / 企查查 / 天眼查）配置专用 UA 与 Referer 抓取企业详情页。
/// 其它域名回退通用 UA。返回纯文本供 AI 解析。
pub async fn fetch_biz_url(url: &str) -> Result<String, String> {
    use reqwest::header::{
        ACCEPT, HeaderMap, HeaderValue,
    };
    let lower = url.to_lowercase();
    let referer = if lower.contains("aiqicha.baidu.com") {
        "https://aiqicha.baidu.com/"
    } else if lower.contains("qcc.com") {
        "https://www.qcc.com/"
    } else if lower.contains("tianyancha.com") {
        "https://www.tianyancha.com/"
    } else {
        ""
    };
    let mut headers = HeaderMap::new();
    headers.insert(reqwest::header::USER_AGENT, HeaderValue::from_static(BROWSER_UA));
    if !referer.is_empty() {
        headers.insert(reqwest::header::REFERER, HeaderValue::from_static(referer));
    }
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
    );
    let client = reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("抓取失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("抓取失败，HTTP {}", resp.status()));
    }
    let html = resp.text().await.map_err(|e| format!("读取响应失败: {e}"))?;
    Ok(strip_html(&html).chars().take(6000).collect())
}

/// 调用 DeepSeek 从爱企查/工商文本提取结构化企业信息
pub async fn parse_company(
    text: &str,
    api_key: &str,
    base_url: &str,
    model: &str,
) -> Result<serde_json::Value, String> {
    let base = if base_url.trim().is_empty() {
        DEFAULT_BASE_URL.to_string()
    } else {
        base_url.trim().trim_end_matches('/').to_string()
    };
    let url = format!("{}/chat/completions", base);
    let model = if model.trim().is_empty() {
        DEFAULT_MODEL.to_string()
    } else {
        model.trim().to_string()
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let system = "你是企业工商信息结构化助手。从文本中识别并提取该企业信息，只输出 JSON 对象，缺失字段给空字符串：\
    {\"name\":\"企业名称\",\"legal_person\":\"法定代表人\",\"capital\":\"注册资本\",\"founded\":\"成立时间\",\
    \"code\":\"统一社会信用代码/工商注册号\",\"status\":\"企业状态\",\"address\":\"注册地址\",\
    \"industry\":\"所属行业\",\"scope\":\"经营范围(≤80字)\",\"risk\":\"风险提示(如经营异常/涉诉/失信, 无则空)\"}";
    let user = json!({"工商文本": text}).to_string();

    let resp = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "temperature": 0.2,
            "response_format": { "type": "json_object" },
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user}
            ]
        }))
        .send()
        .await
        .map_err(|e| format!("请求 DeepSeek 失败: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {e}"))?;
    if !status.is_success() {
        return Err(format!("AI 返回错误状态 {status}: {text}"));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("解析响应 JSON 失败: {e}"))?;
    let content = v["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| format!("响应缺少内容字段: {text}"))?;
    let parsed: serde_json::Value =
        serde_json::from_str(content).map_err(|e| format!("AI 未返回有效 JSON: {e}"))?;
    Ok(parsed)
}

/// 把 AI 解析的企业字段组装成可读快照文本
pub fn biz_info_text(v: &serde_json::Value) -> String {
    let get = |k: &str| -> String {
        v[k].as_str().filter(|s| !s.trim().is_empty()).unwrap_or("").to_string()
    };
    let lines = [
        ("企业名称", get("name")),
        ("法定代表人", get("legal_person")),
        ("注册资本", get("capital")),
        ("成立时间", get("founded")),
        ("信用代码", get("code")),
        ("企业状态", get("status")),
        ("注册地址", get("address")),
        ("所属行业", get("industry")),
        ("经营范围", get("scope")),
        ("风险提示", get("risk")),
    ];
    lines
        .iter()
        .filter(|(_, v)| !v.is_empty())
        .map(|(k, v)| format!("{k}：{v}"))
        .collect::<Vec<_>>()
        .join("\n")
}