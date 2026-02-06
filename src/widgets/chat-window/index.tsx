import React, { useState, useRef } from 'react';
import { Spin } from 'antd';
import { CloudUploadOutlined } from '@ant-design/icons';
import { ChatInputForm } from '@/features/chat-input';
import { ChatMessage } from '@/entities/chat/ui/chat-message';
import { Message, Attachment } from '@/entities/chat/model/types';
import { processFiles } from '@/shared/lib/process-files';
import { useThemeContext } from '@/app/providers/theme-provider';
import './chat-window.css';

interface ChatWindowProps {
  messages: Message[];
  onSendMessage: (message: string, attachments?: Attachment[]) => void;
  loading: boolean;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({ messages, onSendMessage, loading }) => {
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);
  const { theme } = useThemeContext();
  const isDark = theme === 'dark';

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current--;
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const newAttachments = await processFiles(files, attachments.length);
      if (newAttachments.length > 0) {
        setAttachments(prev => [...prev, ...newAttachments]);
      }
    }
  };

  return (
    <div
      className="chat-window-container"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className={`drag-overlay ${isDark ? 'drag-overlay-dark' : ''}`}>
          <div className="drag-overlay-content">
            <CloudUploadOutlined style={{ fontSize: 48 }} />
            <span>Перетащите файлы сюда</span>
            <span className="drag-overlay-hint">JPG, PNG, PDF, MD (макс. 30MB)</span>
          </div>
        </div>
      )}
      <div className="messages-list">
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {loading && <Spin />}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-wrapper">
        <ChatInputForm
          onSendMessage={onSendMessage}
          loading={loading}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
        />
      </div>
    </div>
  );
};
