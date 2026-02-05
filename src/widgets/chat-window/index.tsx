import React from 'react';
import { Spin } from 'antd';
import { ChatInputForm } from '@/features/chat-input';
import { ChatMessage } from '@/entities/chat/ui/chat-message';
import { Message, Attachment } from '@/entities/chat/model/types';
import './chat-window.css';

interface ChatWindowProps {
  messages: Message[];
  onSendMessage: (message: string, attachments?: Attachment[]) => void;
  loading: boolean;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({ messages, onSendMessage, loading }) => {
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="chat-window-container">
      <div className="messages-list">
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {loading && <Spin />}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-wrapper">
        <ChatInputForm onSendMessage={onSendMessage} loading={loading} />
      </div>
    </div>
  );
};
