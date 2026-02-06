import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { queryClient } from '@/app/providers';
import { Message, Attachment } from './types';
import { getConversations, getMessages, createConversation, saveMessage } from '../api/chat-api';
import { useAuthStore } from '@/features/auth';
import { sendAIRequest, ChatMessage, ChatResponse, sendAIRequestStreaming } from '@/shared/api/proxy-api';
import { APIError } from '@/shared/lib/error-handler';
import { logUsage } from '@/entities/limits';
import { Model, MODELS } from '@/shared/config/models.config';
import { getModelsWithAccess, ModelWithAccess, getUserAccessibleModels, AccessibleModel } from '@/entities/models/api/models-api';
import { openRouterApi, OpenRouterModel } from '@/entities/models/api/openrouter-api';
import { usePromptsStore } from '@/entities/prompts';
import { useRagStore } from '@/entities/rag';
import { sendRagQuery } from '@/entities/rag/api/rag-api';
import { debounce } from '@/shared/utils/debounce';

type Conversation = {
    id: string;
    title: string;
    created_at: string;
}

interface CachedResponse {
    response: ChatResponse;
    timestamp: number;
    params: {
        model: string;
        messagesHash: string;
    };
}

interface ChatState {
  conversations: Conversation[];
  messages: Message[];
  activeConversation: string | null;
  selectedModel: string;
  availableModels: Model[];
  openRouterModels: Model[];
  loading: boolean;
  onSendMessageStart: (() => void) | null;
  onError: ((error: { title: string; content: string }) => void) | null;
  lastResponse: ChatResponse | null; // Last AI response in memory
  messagesCache: Map<string, Message[]>; // Cache for messages by conversationId
  conversationAttachments: Map<string, Attachment[]>; // Cache for attachments with data by conversationId
  fetchConversations: (userId: string) => Promise<void>;
  fetchMessages: (conversationId: string) => Promise<void>;
  fetchAvailableModels: (userId: string) => Promise<void>;
  fetchOpenRouterModels: () => Promise<void>;
  setActiveConversation: (conversationId: string | null) => void;
  setSelectedModel: (model: string) => void;
  setErrorHandler: (handler: ((error: { title: string; content: string }) => void) | null) => void;
  sendMessage: (content: string, attachments?: Attachment[]) => void;
  sendRagMessage: (content: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => {
  const initialActiveConversation = (() => {
    try {
      const item = localStorage.getItem('activeConversation');
      return item ? JSON.parse(item) : null;
    } catch (e) {
      console.error('Failed to parse activeConversation from localStorage', e);
      return null;
    }
  })();

  const initialSelectedModel = (() => {
    try {
      return localStorage.getItem('selectedModel') || 'grok-4-fast';
    } catch (e) {
      console.error('Failed to get selectedModel from localStorage', e);
      return 'grok-4-fast';
    }
  })();

  // Helper function to generate hash for messages
  const generateMessagesHash = (messages: ChatMessage[]): string => {
    const messagesStr = JSON.stringify(messages.map(m => ({ role: m.role, content: m.content })));
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < messagesStr.length; i++) {
      const char = messagesStr.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString();
  };

  // Helper function to load cache from localStorage
  const loadCacheFromStorage = (conversationId: string): CachedResponse[] => {
    try {
      const cached = localStorage.getItem(`chat_cache_${conversationId}`);
      if (cached) {
        const parsed = JSON.parse(cached) as CachedResponse[];
        const now = Date.now();
        const TTL = 24 * 60 * 60 * 1000; // 24 hours
        // Filter out expired entries
        return parsed.filter(entry => (now - entry.timestamp) < TTL);
      }
    } catch (e) {
      console.error('Error loading cache from storage:', e);
    }
    return [];
  };

  const debouncedSave = debounce((conversationId: string, cache: CachedResponse[]) => {
      try {
        const toSave = cache.slice(-19);
        localStorage.setItem(`chat_cache_${conversationId}`, JSON.stringify(toSave));
      } catch (e) {
         console.error('Error saving cache to storage:', e);
         // Here you could implement a more robust strategy, like clearing old cache
      }
  }, 1000);


  // Helper function to save cache to localStorage (keep last 19, as last one is in memory)
  const saveCacheToStorage = (conversationId: string, cache: CachedResponse[]) => {
      debouncedSave(conversationId, cache);
  };

  return {
    conversations: [],
    messages: [],
    activeConversation: initialActiveConversation,
    selectedModel: initialSelectedModel,
    availableModels: [],
    openRouterModels: [],
    loading: false,
    onSendMessageStart: null,
    onError: null,
    lastResponse: null,
    messagesCache: new Map<string, Message[]>(),
    conversationAttachments: new Map<string, Attachment[]>(),
    setErrorHandler: (handler) => set({ onError: handler }),
    fetchConversations: async (userId: string) => {
      set({ loading: true });
      try {
        const data = await getConversations(userId);
        set({ conversations: data || [], loading: false });
      } catch (error) {
        set({ loading: false });
      }
    },
    fetchMessages: async (conversationId: string) => {
      // Check cache first - show cached messages immediately
      const cached = get().messagesCache.get(conversationId);
      if (cached && cached.length > 0) {
        set({ messages: cached });
      }

      set({ loading: true });
      try {
        const data = await getMessages(conversationId);
        const messages = data || [];
        // Update cache and messages
        const cache = new Map(get().messagesCache);
        cache.set(conversationId, messages);
        set({ messages, messagesCache: cache, loading: false });
      } catch (error) {
        console.error('Error fetching messages:', error);
        set({ loading: false });
        // Keep cached messages if available, don't clear them on error
        if (!cached || cached.length === 0) {
          set({ messages: [] });
        }
      }
    },
    fetchAvailableModels: async (userId: string) => {
      try {
        // Get models that the user has access to
        const userModels: AccessibleModel[] = await getUserAccessibleModels(userId);
          
        set({ availableModels: userModels.map((m: AccessibleModel) => ({
          id: m.id,
          name: m.name,
          provider: m.provider as Model['provider'],
        })) });

        // If the currently selected model is not in the available list, switch to the first available one
        const currentModelStillAvailable = userModels.some((m: AccessibleModel) => m.id === get().selectedModel);
        if (!currentModelStillAvailable && userModels.length > 0) {
            set({ selectedModel: userModels[0].id });
        }

      } catch (error) {
        console.error('Error fetching available models:', error);
        set({ availableModels: [] });
      }
    },
    fetchOpenRouterModels: async () => {
      try {
        const models = await openRouterApi.getModels();
        
        // Transform OpenRouter models to our Model format
        const transformedModels: Model[] = models.map((m: OpenRouterModel) => ({
          id: m.id,
          name: m.name,
          provider: 'openrouter' as const,
          description: m.description,
          context_length: m.context_length,
          pricing: m.pricing ? {
            prompt: parseFloat(m.pricing.prompt),
            completion: parseFloat(m.pricing.completion),
          } : undefined,
        }));

        set({ openRouterModels: transformedModels });

      } catch (error) {
        console.error('Error fetching OpenRouter models:', error);
        set({ openRouterModels: [] });
      }
    },
    setActiveConversation: (conversationId: string | null) => {
      // Only clear messages if conversation is actually changing
      const currentConversation = get().activeConversation;
      if (currentConversation !== conversationId) {
        set({ activeConversation: conversationId, messages: [] });
        try {
            localStorage.setItem('activeConversation', JSON.stringify(conversationId));
        } catch(e) {
            console.error("Failed to save active conversation to localStorage", e);
        }
        if (conversationId) {
          get().fetchMessages(conversationId);
        } else {
          // Clear cache when switching to new chat
          set({ messagesCache: new Map() });
        }
      }
    },
    setSelectedModel: (model: string) => {
      // Invalidate cache when model changes
      set({ selectedModel: model, lastResponse: null });
      try {
        localStorage.setItem('selectedModel', model);
      } catch (e) {
        console.error("Failed to save selected model to localStorage", e);
      }
    },
    sendMessage: async (content: string, attachments?: Attachment[]) => {
      get().onSendMessageStart?.();

      const { activeConversation, selectedModel, messages, lastResponse } = get();
      const { user } = useAuthStore.getState();
      const { selectedPrompt } = usePromptsStore.getState();
      const { isRagMode, selectedRagObject, selectedLogicalSection } = useRagStore.getState();

      if (!user) return;

      // Check if RAG mode is enabled and required selections are made
      if (isRagMode) {
        if (!selectedRagObject || !selectedLogicalSection) {
          get().onError?.({
            title: 'Ошибка RAG',
            content: 'Выберите объект и логический раздел для использования режима RAG'
          });
          return;
        }

        // Handle RAG mode
        return get().sendRagMessage(content);
      }

      // Continue with standard chat logic
      set({ loading: true });

      const optimisticUserMessage: Message = {
        id: nanoid(),
        conversation_id: activeConversation || 'optimistic-conv-id',
        user_id: user.id,
        role: 'user' as const,
        content: content,
        model: selectedModel,
        created_at: new Date().toISOString(),
        attachments: attachments || null,
      };

      // Сохраняем attachments с data в кэш для текущего диалога
      if (attachments && attachments.length > 0) {
        const convId = activeConversation || 'new-conversation';
        const existingAttachments = get().conversationAttachments.get(convId) || [];
        const newCache = new Map(get().conversationAttachments);
        // Добавляем только те attachments, у которых есть data
        const attachmentsWithData = attachments.filter(att => att.data);
        if (attachmentsWithData.length > 0) {
          newCache.set(convId, [...existingAttachments, ...attachmentsWithData]);
          set({ conversationAttachments: newCache });
        }
      }

      // Add optimistic assistant message for streaming
      const optimisticAssistantId = nanoid();
      const optimisticAssistantMessage: Message = {
        id: optimisticAssistantId,
        conversation_id: activeConversation || 'optimistic-conv-id',
        user_id: user.id,
        role: 'assistant' as const,
        content: '',
        model: selectedModel,
        created_at: new Date().toISOString(),
      };
      
      set((state) => ({ 
        messages: [...state.messages, optimisticUserMessage, optimisticAssistantMessage]
      }));

      try {
        // Build conversation history with system message if prompt is selected
        let conversationHistory: ChatMessage[] = [];
        
        // Add system prompt as first message if selected
        if (selectedPrompt && selectedPrompt.system_prompt) {
          conversationHistory.push({
            role: 'system' as const,
            content: selectedPrompt.system_prompt,
          });
        }
        
        // Получаем закэшированные attachments для этого диалога
        const convId = activeConversation || 'new-conversation';
        const cachedAttachments = get().conversationAttachments.get(convId) || [];

        // Add conversation history (с вложениями из кэша для user сообщений)
        conversationHistory.push(...[...messages, optimisticUserMessage].map(msg => {
          const chatMsg: ChatMessage = { role: msg.role, content: msg.content };

          // Для user сообщений добавляем attachments из кэша (где есть data)
          if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
            // Ищем соответствующие attachments в кэше по имени файла
            const attachmentsWithData = msg.attachments
              .map(att => {
                // Если data есть в текущем attachment — используем его
                if (att.data) return att;
                // Иначе ищем в кэше по имени
                const cached = cachedAttachments.find(c => c.name === att.name && c.data);
                return cached || null;
              })
              .filter((att): att is Attachment => att !== null && !!att.data);

            if (attachmentsWithData.length > 0) {
              chatMsg.attachments = attachmentsWithData.map(att => ({
                type: att.type,
                name: att.name,
                mime_type: att.mime_type,
                size: att.size,
                data: att.data!,
              }));
            }
          }

          return chatMsg;
        }));

        // Generate hash for cache lookup
        const messagesHash = generateMessagesHash(conversationHistory);
        const cacheKey = `${selectedModel}_${messagesHash}`;

        // Check cache (first in memory, then localStorage)
        let cachedResponse: CachedResponse | undefined;
        
        // Check if last response matches
        if (lastResponse && lastResponse.id === activeConversation) {
          // This is approximate - in real scenario we'd need better matching
          // For now, we'll always fetch fresh data but cache responses
        }

        // Check localStorage cache
        if (activeConversation) {
          const storageCache = loadCacheFromStorage(activeConversation);
          cachedResponse = storageCache.find(c => c.params.messagesHash === messagesHash && c.params.model === selectedModel);
        }

        let aiResponseData: ChatResponse;
        
        if (cachedResponse && (Date.now() - cachedResponse.timestamp) < 24 * 60 * 60 * 1000) {
          // Use cached response
          aiResponseData = cachedResponse.response;
        } else {
          // Prepare request parameters (only temperature and top_p, model and messages are passed separately)
          const requestParams = {
            temperature: selectedPrompt?.temperature,
            top_p: selectedPrompt?.top_p,
          };

          // Fetch from API with streaming
          aiResponseData = await new Promise((resolve, reject) => {
            let fullResponse: ChatResponse | null = null;
            
            sendAIRequestStreaming(
              selectedModel,
              conversationHistory,
              activeConversation,
              requestParams,
              // onChunk: update the assistant message content in real-time
              (chunk: string) => {
                set((state) => {
                  // Find the assistant message (last one added after optimistic user message)
                  const lastMessage = state.messages[state.messages.length - 1];
                  if (lastMessage && lastMessage.role === 'assistant') {
                    return {
                      messages: [
                        ...state.messages.slice(0, -1),
                        {
                          ...lastMessage,
                          content: lastMessage.content + chunk,
                        },
                      ],
                    };
                  }
                  return state;
                });
              },
              // onComplete: resolve with full response
              (response: ChatResponse) => {
                fullResponse = response;
                resolve(response);
              },
              // onError: reject with error
              (error: Error) => {
                reject(error);
              }
            );
          });

          // Save to cache
          const cacheEntry: CachedResponse = {
            response: aiResponseData,
            timestamp: Date.now(),
            params: {
              model: selectedModel,
              messagesHash,
            },
          };

          // Save last response in memory
          set({ lastResponse: aiResponseData });

          // Save to localStorage cache
          if (activeConversation) {
            const storageCache = loadCacheFromStorage(activeConversation);
            storageCache.push(cacheEntry);
            // Keep only last 20 entries (1 in memory + 19 in storage)
            const trimmedCache = storageCache.slice(-19);
            saveCacheToStorage(activeConversation, trimmedCache);
          }
        }

        // If a new conversation was created, update the store and UI
        console.log('[ChatStore] After response - activeConversation:', activeConversation, 'aiResponseData.id:', aiResponseData.id);
        if (!activeConversation && aiResponseData.id) {
            console.log('[ChatStore] Creating new conversation:', aiResponseData.id);

            // Переносим кэш attachments на новый conversationId
            const tempAttachments = get().conversationAttachments.get('new-conversation');
            if (tempAttachments && tempAttachments.length > 0) {
              const newCache = new Map(get().conversationAttachments);
              newCache.set(aiResponseData.id, tempAttachments);
              newCache.delete('new-conversation');
              set({ conversationAttachments: newCache });
            }

            get().setActiveConversation(aiResponseData.id);
            get().fetchConversations(user.id);
        }

        // Refetch messages to get the real IDs and content from DB
        await get().fetchMessages(get().activeConversation!);

        // Invalidate usage stats queries so header counter updates immediately
        queryClient.invalidateQueries({ queryKey: ['usageStats'] });
        queryClient.invalidateQueries({ queryKey: ['currentUserSimpleStats'] });

      } catch (error) {
        console.error('Error in sendMessage:', error);
        
        // On error, remove both optimistic messages
        set((state) => ({ 
          messages: state.messages.filter(m => 
            m.id !== optimisticUserMessage.id && m.id !== optimisticAssistantId
          ) 
        }));

        let title = 'Ошибка запроса';
        let content = 'Не удалось выполнить запрос. Попробуйте позже.';

        if (error instanceof APIError) {
          switch (error.code) {
            case 'DAILY_LIMIT_EXCEEDED':
              title = 'Дневной лимит превышен';
              break;
            case 'HOURLY_LIMIT_EXCEEDED':
                title = 'Часовой лимит стоимости превышен';
                break;
            case 'STREAM_ERROR':
                title = 'Ошибка получения ответа от модели';
                break;
            default:
                title = 'Ошибка сервера';
          }
          content = error.message || content;
          if (error.details) {
              content += `\n\nДетали: ${error.details}`;
          }
        } else if (error instanceof Error) {
          content = error.message || content;
        }

        const errorHandler = get().onError;
        if (errorHandler) {
          errorHandler({ title, content });
        } else {
          console.error(title, content);
        }
        
      } finally {
          set({ loading: false });
          queryClient.invalidateQueries({ queryKey: ['usageStats', user?.id] });
      }
    },
    
    // RAG message sending function
    sendRagMessage: async (content: string) => {
      const { selectedModel, messages, activeConversation } = get();
      const { user } = useAuthStore.getState();
      const { selectedRagObject, selectedLogicalSection } = useRagStore.getState();

      if (!user || !selectedRagObject || !selectedLogicalSection) return;

      set({ loading: true });

      // Use existing conversation_id if in an active conversation, otherwise null (will be created on server)
      const conversationId = activeConversation || null;

      const optimisticUserMessage: Message = {
        id: nanoid(),
        conversation_id: conversationId,
        user_id: user.id,
        role: 'user' as const,
        content: content,
        model: `RAG-${selectedModel}`,
        created_at: new Date().toISOString(),
      };

      const optimisticAssistantId = nanoid();
      const optimisticAssistantMessage: Message = {
        id: optimisticAssistantId,
        conversation_id: conversationId,
        user_id: user.id,
        role: 'assistant' as const,
        content: '',
        model: `RAG-${selectedModel}`,
        created_at: new Date().toISOString(),
      };

      set((state) => ({ 
        messages: [...state.messages, optimisticUserMessage, optimisticAssistantMessage]
      }));

      try {
        // Build conversation history
        const conversationHistory: ChatMessage[] = [...messages, optimisticUserMessage].map(msg => ({
          role: msg.role,
          content: msg.content,
        }));

        // Send RAG query
        await sendRagQuery(
          selectedRagObject.id,
          selectedLogicalSection.id,
          content,
          selectedModel,
          conversationHistory,
          conversationId,
          // onChunk
          (chunk: string) => {
            set((state) => {
              const lastMessage = state.messages[state.messages.length - 1];
              if (lastMessage && lastMessage.id === optimisticAssistantId) {
                const updatedMessages = [...state.messages];
                updatedMessages[updatedMessages.length - 1] = {
                  ...lastMessage,
                  content: lastMessage.content + chunk
                };
                return { messages: updatedMessages };
              }
              return state;
            });
          },
          // onComplete - receives conversationId from server
          (conversationId: string) => {
            console.log('[ChatStore] RAG response complete, conversationId:', conversationId);
            set({ loading: false });
            
            // Update optimistic messages with real conversation_id
            set((state) => ({
              messages: state.messages.map(msg => 
                (msg.id === optimisticUserMessage.id || msg.id === optimisticAssistantId)
                  ? { ...msg, conversation_id: conversationId }
                  : msg
              )
            }));
            
            // Update active conversation
            get().setActiveConversation(conversationId);
            get().fetchConversations(user.id);
          },
          // onError
          (error: string) => {
            set({ loading: false });
            get().onError?.({
              title: 'Ошибка RAG',
              content: error
            });
            // Remove optimistic messages on error
            set((state) => ({
              messages: state.messages.filter(
                m => m.id !== optimisticUserMessage.id && m.id !== optimisticAssistantId
              )
            }));
          }
        );

      } catch (error: any) {
        set({ loading: false });
        get().onError?.({
          title: 'Ошибка RAG',
          content: error.message || 'Не удалось отправить RAG-запрос'
        });
        // Remove optimistic messages on error
        set((state) => ({
          messages: state.messages.filter(
            m => m.id !== optimisticUserMessage.id && m.id !== optimisticAssistantId
          )
        }));
      }
    },
  };
});

// Add this function to check for the correct provider name, as it was missing in the Deepseek case
function getSelectedAIModel(selectedModel: string): string {
    const model = MODELS.find(m => m.id === selectedModel);
    if (!model) return selectedModel; // fallback
    
    // Gemini has a different naming convention in some places
    if (model.provider === 'gemini' && model.id.startsWith('gemini-')) {
        return model.id;
    }
    
    return model.id;
}
