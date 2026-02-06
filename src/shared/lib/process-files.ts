import { message } from 'antd';
import type { Attachment } from '@/entities/chat/model/types';

export const ACCEPTED_TYPES: Record<string, { type: Attachment['type']; extensions: string[] }> = {
    'image/jpeg': { type: 'image', extensions: ['.jpg', '.jpeg'] },
    'image/png': { type: 'image', extensions: ['.png'] },
    'application/pdf': { type: 'pdf', extensions: ['.pdf'] },
    'text/markdown': { type: 'markdown', extensions: ['.md'] },
};

export const ACCEPT_STRING = Object.values(ACCEPTED_TYPES).flatMap(t => t.extensions).join(',');
export const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30MB
export const MAX_FILES = 10;

export const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

export const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsText(file);
    });
};

const getFileTypeConfig = (file: File): { type: Attachment['type']; mimeType: string } | null => {
    const mimeConfig = ACCEPTED_TYPES[file.type];
    if (mimeConfig) {
        return { type: mimeConfig.type, mimeType: file.type };
    }

    // Fallback: проверка по расширению для .md файлов
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    const fallback = Object.entries(ACCEPTED_TYPES).find(([, config]) => config.extensions.includes(ext));
    if (fallback) {
        return { type: fallback[1].type, mimeType: fallback[0] };
    }

    return null;
};

export const processFiles = async (
    files: FileList | File[],
    currentCount: number
): Promise<Attachment[]> => {
    const fileArray = Array.from(files);
    const remaining = MAX_FILES - currentCount;

    if (remaining <= 0) {
        message.warning(`Максимум ${MAX_FILES} файлов`);
        return [];
    }

    if (fileArray.length > remaining) {
        message.warning(`Можно добавить только ${remaining} файл(ов). Остальные пропущены.`);
    }

    const filesToProcess = fileArray.slice(0, remaining);
    const newAttachments: Attachment[] = [];

    for (const file of filesToProcess) {
        if (file.size > MAX_FILE_SIZE) {
            message.error(`Файл "${file.name}" слишком большой (макс. 30MB)`);
            continue;
        }

        const typeConfig = getFileTypeConfig(file);
        if (!typeConfig) {
            message.error(`Неподдерживаемый формат: ${file.name}`);
            continue;
        }

        const data = typeConfig.type === 'markdown'
            ? await readFileAsText(file)
            : await readFileAsBase64(file);

        newAttachments.push({
            type: typeConfig.type,
            name: file.name,
            mime_type: typeConfig.mimeType,
            size: file.size,
            data,
        });
    }

    return newAttachments;
};
