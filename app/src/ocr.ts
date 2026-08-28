// 离线 OCR：基于 Tesseract.js（WASM 本地识别，图片不出本机）
import { createWorker, type Worker } from 'tesseract.js'

// 识别中文字符集；模型与核心首次使用时会下载并缓存
const LANGS = 'chi_sim+eng'

let workerPromise: Promise<Worker> | null = null

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker(LANGS, 1, {
      logger: (_m) => {
        /* 可在此回显进度，暂不处理 */
      },
    })
  }
  return workerPromise
}

/**
 * 识别图片中的文本
 * @param file 用户选择的图片文件
 * @param onProgress 进度回调（0-1）
 */
export async function ocrImage(
  file: Blob | File,
  onProgress?: (p: number) => void,
): Promise<string> {
  const worker = await getWorker()
  const result = await worker.recognize(file, {}, { text: true })
  if (onProgress) onProgress(1)
  return result.data.text
}

/** 释放 OCR 资源 */
export async function disposeOcr() {
  if (workerPromise) {
    const w = await workerPromise
    await w.terminate()
    workerPromise = null
  }
}