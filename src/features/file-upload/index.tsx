import React, { useRef } from 'react';
import { Button, Tag, Tooltip, message } from 'antd';
import { PaperClipOutlined, DeleteOutlined, FileImageOutlined, FilePdfOutlined, FileMarkdownOutlined } from '@ant-design/icons';
import { useThemeContext } from '@/app/providers/theme-provider';
import type { Attachment } from '@/entities/chat/model/types';

const ACCEPTED_TYPES: Record<string, { type: Attachment['type']; extensions: string[] }> = {
    'image/jpeg': { type: 'image', extensions: ['.jpg', '.jpeg'] },
    'image/png': { type: 'image', extensions: ['.png'] },
    'application/pdf': { type: 'pdf', extensions: ['.pdf'] },
    'text/markdown': { type: 'markdown', extensions: ['.md'] },
};

const ACCEPT_STRING = Object.values(ACCEPTED_TYPES).flatMap(t => t.extensions).join(',');
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_FILES = 5;

interface FileUploadProps {
    attachments: Attachment[];
    onChange: (attachments: Attachment[]) => void;
    disabled?: boolean;
}

const getFileIcon = (type: Attachment['type']) => {
    switch (type) {
        case 'image': return <FileImageOutlined />;
        case 'pdf': return <FilePdfOutlined />;
        case 'markdown': return <FileMarkdownOutlined />;
    }
};

const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            // Для base64 убираем префикс data:...;base64,
            const base64 = result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsText(file);
    });
};

export const FileUpload: React.FC<FileUploadProps> = ({ attachments, onChange, disabled }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const { theme } = useThemeContext();
    const isDark = theme === 'dark';

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;

        const remaining = MAX_FILES - attachments.length;
        if (remaining <= 0) {
            message.warning(`Максимум ${MAX_FILES} файлов`);
            return;
        }

        const newAttachments: Attachment[] = [];

        for (let i = 0; i < Math.min(files.length, remaining); i++) {
            const file = files[i];

            if (file.size > MAX_FILE_SIZE) {
                message.error(`Файл "${file.name}" слишком большой (макс. 20MB)`);
                continue;
            }

            const mimeConfig = ACCEPTED_TYPES[file.type];
            if (!mimeConfig) {
                // Проверка по расширению для .md файлов (браузер может не определить text/markdown)
                const ext = '.' + file.name.split('.').pop()?.toLowerCase();
                const fallback = Object.values(ACCEPTED_TYPES).find(t => t.extensions.includes(ext));
                if (!fallback) {
                    message.error(`Неподдерживаемый формат: ${file.name}`);
                    continue;
                }

                const data = fallback.type === 'markdown'
                    ? await readFileAsText(file)
                    : await readFileAsBase64(file);

                newAttachments.push({
                    type: fallback.type,
                    name: file.name,
                    mime_type: file.type || 'text/markdown',
                    size: file.size,
                    data,
                });
                continue;
            }

            const data = mimeConfig.type === 'markdown'
                ? await readFileAsText(file)
                : await readFileAsBase64(file);

            newAttachments.push({
                type: mimeConfig.type,
                name: file.name,
                mime_type: file.type,
                size: file.size,
                data,
            });
        }

        onChange([...attachments, ...newAttachments]);

        // Сброс input для повторного выбора
        if (inputRef.current) {
            inputRef.current.value = '';
        }
    };

    const removeAttachment = (index: number) => {
        onChange(attachments.filter((_, i) => i !== index));
    };

    const formatSize = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    return (
        <div>
            <input
                ref={inputRef}
                type="file"
                accept={ACCEPT_STRING}
                multiple
                style={{ display: 'none' }}
                onChange={handleFileSelect}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <Tooltip title="Прикрепить файл (JPG, PNG, PDF, MD)">
                    <Button
                        type="text"
                        icon={<PaperClipOutlined />}
                        onClick={() => inputRef.current?.click()}
                        disabled={disabled || attachments.length >= MAX_FILES}
                        size="small"
                        style={{ color: isDark ? '#a0a0a0' : '#666666' }}
                    />
                </Tooltip>
                {attachments.map((att, i) => (
                    <Tag
                        key={i}
                        closable
                        onClose={() => removeAttachment(i)}
                        icon={getFileIcon(att.type)}
                        style={{
                            maxWidth: 200,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            background: isDark ? '#3a3a3a' : '#f5f5f5',
                            borderColor: isDark ? '#555' : '#d9d9d9',
                            color: isDark ? '#e0e0e0' : '#333',
                        }}
                    >
                        <Tooltip title={`${att.name} (${formatSize(att.size)})`}>
                            <span style={{ fontSize: 12 }}>{att.name.length > 15 ? att.name.slice(0, 12) + '...' : att.name}</span>
                        </Tooltip>
                    </Tag>
                ))}
            </div>
        </div>
    );
};
