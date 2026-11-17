import { createCanvas } from '@napi-rs/canvas';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

export type PdfExtractResult = {
  text: string;
  pages: number;
  method: 'text-layer' | 'vision-ocr';
};

const MIN_LAYER_CHARS = 8;
const OCR_MAX_PAGES = 40;
const RENDER_SCALE = 1.5;
const OCR_PROMPT =
  '请提取图片中的全部可见文字，保持原有阅读顺序。只输出文字内容，不要解释、不要翻译、不要添加标题。';

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsLoad: Promise<PdfjsModule> | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsLoad) {
    pdfjsLoad = (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const require = createRequire(__filename);
      const workerPath = require.resolve(
        'pdfjs-dist/legacy/build/pdf.worker.mjs',
      );
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
      return pdfjs;
    })();
  }
  return pdfjsLoad;
}

function compactText(content: string): string {
  return content
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isSparseText(text: string): boolean {
  const letters = text.replace(/[^\p{L}\p{N}]+/gu, '');
  return letters.length < MIN_LAYER_CHARS;
}

/**
 * PDF 文本抽取：优先文本层，空文本/打印件则渲染后走视觉 OCR。
 */
@Injectable()
export class PdfTextExtractor {
  private readonly logger = new Logger(PdfTextExtractor.name);

  constructor(private readonly config: ConfigService) {}

  async extract(buffer: Buffer): Promise<PdfExtractResult> {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      disableFontFace: true,
    }).promise;
    try {
      const pages = doc.numPages;
      const layerParts: string[] = [];
      for (let i = 1; i <= pages; i += 1) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ');
        layerParts.push(pageText);
      }
      const layerText = compactText(layerParts.join('\n'));
      if (!isSparseText(layerText)) {
        return { text: layerText, pages, method: 'text-layer' };
      }

      this.logger.warn(
        `PDF 文本层为空或过少（${layerText.replace(/[^\p{L}\p{N}]+/gu, '').length} 字 / ${pages} 页），改用视觉识别`,
      );
      const ocrText = compactText(
        await this.ocrPages(doc, Math.min(pages, OCR_MAX_PAGES)),
      );
      if (!ocrText) {
        throw new Error(
          '该 PDF 为图形/打印件，识别后仍没有可读取的文本。请上传带可选中文字的 PDF。',
        );
      }
      return { text: ocrText, pages, method: 'vision-ocr' };
    } finally {
      await doc.cleanup();
    }
  }

  private async ocrPages(
    doc: PDFDocumentProxy,
    pageCount: number,
  ): Promise<string> {
    const apiKey = this.config.get<string>('AI_API_KEY') || '';
    const baseURL = this.config.get<string>('OPENAI_BASE_URL') || '';
    const model =
      this.config.get<string>('PDF_OCR_MODEL') || 'qwen-vl-ocr';
    if (!apiKey || !baseURL) {
      throw new Error(
        '该 PDF 没有可提取的文本层（多为“打印为 PDF”或扫描件）。请配置 AI_API_KEY / OPENAI_BASE_URL 以启用视觉识别，或改用带文本层的 PDF。',
      );
    }

    const parts: string[] = [];
    for (let i = 1; i <= pageCount; i += 1) {
      const page = await doc.getPage(i);
      const jpeg = await this.renderPageJpeg(page);
      const text = await this.recognizePage(baseURL, apiKey, model, jpeg, i);
      if (text) parts.push(text);
    }
    return parts.join('\n');
  }

  private async renderPageJpeg(page: PDFPageProxy): Promise<Buffer> {
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    const ctx = canvas.getContext('2d');
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    return canvas.toBuffer('image/jpeg', 80);
  }

  private async recognizePage(
    baseURL: string,
    apiKey: string,
    model: string,
    image: Buffer,
    pageNumber: number,
  ): Promise<string> {
    const endpoint = `${baseURL.replace(/\/$/, '')}/chat/completions`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${image.toString('base64')}`,
                },
              },
              { type: 'text', text: OCR_PROMPT },
            ],
          },
        ],
      }),
    });
    const payload = (await res.json()) as {
      error?: { message?: string };
      message?: string;
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    if (!res.ok) {
      const detail =
        payload.error?.message || payload.message || res.statusText;
      throw new Error(`PDF 第 ${pageNumber} 页视觉识别失败：${detail}`);
    }
    const content = payload.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content : '';
    this.logger.log(
      `PDF OCR page ${pageNumber} model=${model} chars=${text.trim().length}`,
    );
    return compactText(text);
  }
}
