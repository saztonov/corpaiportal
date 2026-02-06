import React, { useRef } from 'react';
import { Button, Tag, Tooltip } from 'antd';
import { PaperClipOutlined, FileImageOutlined, FilePdfOutlined, FileMarkdownOutlined } from '@ant-design/icons';
import { useThemeContext } from '@/app/providers/theme-provider';
import type { Attachment } from '@/entities/chat/model/types';
import { processFiles, ACCEPT_STRING, MAX_FILES } from '@/shared/lib/process-files';

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

export const FileUpload: React.FC<FileUploadProps> = ({ attachments, onChange, disabled }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const { theme } = useThemeContext();
    const isDark = theme === 'dark';

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;

        const newAttachments = await processFiles(files, attachments.length);
        if (newAttachments.length > 0) {
            onChange([...attachments, ...newAttachments]);
        }

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
                <Tooltip title="Прикрепить файл (JPG, PNG, PDF, MD — макс. 30MB)" color="rgba(0, 0, 0, 0.85)">
                    <span style={{ display: 'inline-block' }}>
                        <Button
                            type="text"
                            icon={<PaperClipOutlined />}
                            onClick={() => inputRef.current?.click()}
                            disabled={disabled || attachments.length >= MAX_FILES}
                            size="small"
                            style={{ color: isDark ? '#a0a0a0' : '#666666' }}
                        />
                    </span>
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
