import { SupabaseClient } from '@supabase/supabase-js';
import axios, { AxiosError } from 'axios';
import { z } from 'zod';
import { AI_PROVIDERS_CONFIG, OPENROUTER_CONFIG } from '../config/aiProviders';
import { LIMITS } from '../config/limits';
import { ChatRequestPayload } from '../middleware/validation';
import { Response } from 'express';
import { costLimiterService } from './costLimiterService';

// Zod Schemas for validating responses from AI providers
const openAIUsageSchema = z.object({
    prompt_tokens: z.number().int(),
    completion_tokens: z.number().int(),
    total_tokens: z.number().int(),
});

const openAIChoiceSchema = z.object({
    message: z.object({
        role: z.literal('assistant'),
        content: z.string().nullable(),
    }),
});

const openAIResponseSchema = z.object({
    choices: z.array(openAIChoiceSchema).min(1),
    usage: openAIUsageSchema.optional(),
});

const geminiResponseSchema = z.object({
    candidates: z.array(z.object({
        content: z.object({
            parts: z.array(z.object({
                text: z.string(),
            })).min(1),
        }),
    })).min(1),
});

type ModelRoutingConfig = Record<string, { useOpenRouter: boolean; openRouterModelId: string }>;

class ChatService {
    private supabase: SupabaseClient;
    private modelRoutingConfig: ModelRoutingConfig = {};
    private pricingCache: Record<string, { pricing: { prompt: number; completion: number } }> = {};
    private pricingCacheTimestamp: number = 0;
    // TODO: Add cost limiter service

    constructor(supabase: SupabaseClient) {
        this.supabase = supabase;
        this.loadModelRoutingConfig();
        this.fetchOpenRouterPricing();
    }

    public async loadModelRoutingConfig() {
        try {
            const { data, error } = await this.supabase.from('model_routing_config').select('*');
            if (error) throw error;

            const newConfig: ModelRoutingConfig = {};
            data?.forEach((config: any) => {
                newConfig[config.model_id] = {
                    useOpenRouter: config.use_openrouter,
                    openRouterModelId: config.openrouter_model_id,
                };
            });
            this.modelRoutingConfig = newConfig;
            console.log('>>> Model routing configuration loaded.');
        } catch (error: any) {
            console.error('Failed to load model routing config:', error.message);
        }
    }

    public async handleStreamChatRequest(payload: ChatRequestPayload, userId: string, res: Response) {
        // Shared logic for both streaming and non-streaming
        await this.checkUserLimits(userId);

        let conversationId = payload.conversationId;
        if (!conversationId) {
            conversationId = await this.createConversation(userId, payload.messages);
        }

        const userMessage = payload.messages[payload.messages.length - 1];
        // Сохраняем сообщение с метаданными вложений (без base64 данных — в БД храним только мету)
        const attachmentsMeta = userMessage.attachments?.map(att => ({
            type: att.type, name: att.name, mime_type: att.mime_type, size: att.size,
        })) || null;
        await this.saveMessage(conversationId, userId, 'user', userMessage.content, undefined, attachmentsMeta);
        
        // Cost check before proceeding
        const estimatedCost = 0.01; // Assume a small cost for now, can be improved
        if (!costLimiterService.canProceed(estimatedCost)) {
            const err = new Error('Hourly cost limit exceeded. Please try again later.');
            (err as any).code = 'HOURLY_LIMIT_EXCEEDED';
            throw err;
        }

        // Streaming specific logic
        const { targetUrl, apiKey, requestBody, provider } = this.prepareAIRequest(payload, true);

        const streamTimeout = setTimeout(() => {
            res.write(`data: ${JSON.stringify({ type: 'error', error: `Stream timeout after ${LIMITS.STREAM_TIMEOUT / 1000} seconds` })}\n\n`);
            res.end();
        }, LIMITS.STREAM_TIMEOUT);

        try {
            const aiResponse = await axios.post(targetUrl, requestBody, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                responseType: 'stream',
            });

            let fullContent = '';
            
            console.log('[ChatService] Setting up stream handlers');
            
            aiResponse.data.on('data', (chunk: Buffer) => {
                console.log('[ChatService] Received chunk from AI provider:', chunk.length, 'bytes');
                // Reset timeout on each data chunk
                clearTimeout(streamTimeout);
                setTimeout(() => {
                    if (!res.writableEnded) {
                         res.write(`data: ${JSON.stringify({ type: 'error', error: `Stream timeout after ${LIMITS.STREAM_TIMEOUT / 1000} seconds` })}\n\n`);
                         res.end();
                    }
                }, LIMITS.STREAM_TIMEOUT);
                
                try {
                    const lines = chunk.toString().split('\n').filter((line: string) => line.trim());
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') {
                                console.log('[ChatService] Stream completed (DONE)');
                                continue;
                            }
                            
                            const parsed = JSON.parse(data);
                            if (parsed.choices && parsed.choices[0]?.delta?.content) {
                                const contentChunk = parsed.choices[0].delta.content;
                                fullContent += contentChunk;
                                console.log('[ChatService] Writing content chunk:', contentChunk.length, 'chars');
                                res.write(`data: ${JSON.stringify({ type: 'content', content: contentChunk })}\n\n`);
                            }
                        }
                    }
                } catch(e) {
                    console.error('[ChatService] Error parsing chunk:', (e as Error).message);
                    // This can happen with partial JSON chunks, ignore for now
                }
            });

            aiResponse.data.on('end', async () => {
                clearTimeout(streamTimeout);
                try {
                     const { id: assistantMessageId } = await this.saveMessage(conversationId!, userId, 'assistant', fullContent, payload.model);
                     const { cost } = await this.logUsage(userId, payload.model, fullContent, provider);
                     if (cost) {
                       costLimiterService.addCost(cost);
                     }
    
                    res.write(`data: ${JSON.stringify({ type: 'complete', id: conversationId, message_id: assistantMessageId })}\n\n`);
                    res.end();
                } catch(error) {
                     console.error('Error saving message on stream end:', error);
                     res.write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to save response.' })}\n\n`);
                     res.end();
                }
            });

            aiResponse.data.on('error', (error: any) => {
                clearTimeout(streamTimeout);
                console.error('Stream error:', error);
                if (!res.writableEnded) {
                    res.write(`data: ${JSON.stringify({ type: 'error', error: 'Streaming error occurred' })}\n\n`);
                    res.end();
                }
            });

        } catch (error) {
             clearTimeout(streamTimeout);
             console.error("Error calling AI provider:", error);
             const axiosError = error as AxiosError;
             const errorMessage = (axiosError.response?.data as any)?.error?.message || axiosError.message;
             if (!res.writableEnded) {
                res.status(axiosError.response?.status || 500).write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to connect to AI provider', details: errorMessage })}\n\n`);
                res.end();
             }
        }
    }

    // Формирует multimodal content для OpenAI/OpenRouter формата
    private buildOpenAIContent(msg: { content: string; attachments?: any[] }): string | any[] {
        if (!msg.attachments || msg.attachments.length === 0) {
            return msg.content;
        }
        const parts: any[] = [{ type: 'text', text: msg.content }];
        for (const att of msg.attachments) {
            if (att.type === 'image') {
                parts.push({
                    type: 'image_url',
                    image_url: { url: `data:${att.mime_type};base64,${att.data}` },
                });
            } else if (att.type === 'pdf') {
                parts.push({
                    type: 'file',
                    file: { filename: att.name, file_data: `data:${att.mime_type};base64,${att.data}` },
                });
            } else if (att.type === 'markdown') {
                parts.push({ type: 'text', text: `\n\n--- Файл: ${att.name} ---\n${att.data}\n---` });
            }
        }
        return parts;
    }

    // Формирует multimodal content для Claude (Anthropic) формата
    private buildClaudeContent(msg: { content: string; attachments?: any[] }): string | any[] {
        if (!msg.attachments || msg.attachments.length === 0) {
            return msg.content;
        }
        const parts: any[] = [];
        for (const att of msg.attachments) {
            if (att.type === 'image') {
                parts.push({
                    type: 'image',
                    source: { type: 'base64', media_type: att.mime_type, data: att.data },
                });
            } else if (att.type === 'pdf') {
                parts.push({
                    type: 'document',
                    source: { type: 'base64', media_type: 'application/pdf', data: att.data },
                });
            } else if (att.type === 'markdown') {
                parts.push({ type: 'text', text: `\n\n--- Файл: ${att.name} ---\n${att.data}\n---` });
            }
        }
        parts.push({ type: 'text', text: msg.content });
        return parts;
    }

    // Формирует multimodal parts для Gemini формата
    private buildGeminiParts(msg: { content: string; attachments?: any[] }): any[] {
        const parts: any[] = [];
        if (msg.attachments && msg.attachments.length > 0) {
            for (const att of msg.attachments) {
                if (att.type === 'image') {
                    parts.push({ inline_data: { mime_type: att.mime_type, data: att.data } });
                } else if (att.type === 'pdf') {
                    parts.push({ inline_data: { mime_type: 'application/pdf', data: att.data } });
                } else if (att.type === 'markdown') {
                    parts.push({ text: `\n\n--- Файл: ${att.name} ---\n${att.data}\n---` });
                }
            }
        }
        parts.push({ text: msg.content });
        return parts;
    }

    private prepareAIRequest(payload: ChatRequestPayload, stream: boolean) {
        const { model, messages, temperature, top_p } = payload;

        const routeConfig = this.modelRoutingConfig[model];
        const useOpenRouter = routeConfig?.useOpenRouter ?? false;

        console.log(`[ChatService] Preparing request for model: ${model}`, {
            hasRouteConfig: !!routeConfig,
            useOpenRouter,
            openRouterModelId: routeConfig?.openRouterModelId
        });

        let targetUrl: string;
        let apiKey: string | undefined;
        let requestBody: any;
        let provider: string;

        if (useOpenRouter && OPENROUTER_CONFIG.apiKey) {
            targetUrl = OPENROUTER_CONFIG.url;
            apiKey = OPENROUTER_CONFIG.apiKey;
            provider = 'openrouter';
            const orModelId = routeConfig.openRouterModelId || model;
            const isClaudeModel = orModelId.startsWith('anthropic/');

            const formattedMessages = messages.map(msg => ({
                role: msg.role,
                content: isClaudeModel ? this.buildClaudeContent(msg) : this.buildOpenAIContent(msg),
            }));

            requestBody = { model: orModelId, messages: formattedMessages, stream };
        } else {
            const providerConfig = AI_PROVIDERS_CONFIG[model];
            if (!providerConfig || !providerConfig.apiKey) {
                throw new Error(`Configuration for model ${model} is missing or incomplete.`);
            }
            targetUrl = providerConfig.url;
            apiKey = providerConfig.apiKey;
            provider = providerConfig.provider;

            if (provider === 'gemini') {
                 requestBody = {
                    contents: messages
                        .filter(msg => msg.role === 'user' || msg.role === 'assistant')
                        .map(msg => ({
                            role: msg.role === 'assistant' ? 'model' : 'user',
                            parts: this.buildGeminiParts(msg),
                        })),
                 };
            } else {
                const formattedMessages = messages.map(msg => ({
                    role: msg.role,
                    content: this.buildOpenAIContent(msg),
                }));
                requestBody = { model, messages: formattedMessages, stream };
            }
        }

        if (temperature !== null && temperature !== undefined) {
             if(provider === 'gemini') {
                requestBody.generationConfig = { ...(requestBody.generationConfig || {}), temperature };
             } else {
                requestBody.temperature = temperature;
             }
        }
        if (top_p !== null && top_p !== undefined) {
            requestBody.top_p = top_p;
        }

        if (!apiKey) {
            throw new Error(`API key for provider ${provider} is not configured.`);
        }

        return { targetUrl, apiKey, requestBody, provider };
    }

    private async checkUserLimits(userId: string) {
        const { data: profile, error: profileError } = await this.supabase
            .from('user_profiles')
            .select('daily_request_limit')
            .eq('id', userId)
            .single();

        if (profileError || !profile) {
            throw new Error('Could not fetch user profile.');
        }

        const today = new Date().toISOString().slice(0, 10);
        const todayStart = `${today}T00:00:00.000Z`;

        const { count, error: countError } = await this.supabase
            .from('usage_logs')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('status', 'success')
            .gte('created_at', todayStart);

        if (countError) {
            throw new Error('Could not count user usage.');
        }

        const requestLimit = profile.daily_request_limit || LIMITS.DEFAULT_DAILY_REQUEST_LIMIT;
        if (count !== null && count >= requestLimit) {
            const err = new Error('Вы достигли дневного лимита запросов.');
            (err as any).code = 'DAILY_LIMIT_EXCEEDED';
            throw err;
        }
    }

    private async createConversation(userId: string, messages: ChatRequestPayload['messages']): Promise<string> {
        const userMessages = messages.filter((msg) => msg.role === 'user');
        const lastUserMessage = userMessages[userMessages.length - 1]?.content || 'New Chat';
        const title = lastUserMessage.substring(0, 50);

        const { data: newConversation, error: createError } = await this.supabase
            .from('conversations')
            .insert({ user_id: userId, title })
            .select('id')
            .single();

        if (createError) throw createError;
        return newConversation.id;
    }

    private async saveMessage(conversationId: string, userId: string, role: 'user' | 'assistant', content: string, model?: string, attachments?: any[] | null) {
        const insertData: any = {
            conversation_id: conversationId,
            user_id: userId,
            role,
            content,
            model,
        };
        if (attachments && attachments.length > 0) {
            insertData.attachments = attachments;
        }
        const { data, error } = await this.supabase
            .from('messages')
            .insert(insertData)
            .select('id')
            .single();
        if (error) throw error;
        return data;
    }

    public async fetchOpenRouterPricing() {
        const now = Date.now();
        if (Object.keys(this.pricingCache).length > 0 && now - this.pricingCacheTimestamp < LIMITS.PRICING_CACHE_DURATION) {
            return;
        }

        try {
            const response = await axios.get('https://openrouter.ai/api/v1/models', {
                headers: { 'Authorization': `Bearer ${OPENROUTER_CONFIG.apiKey}` },
            });
            const models = response.data.data || [];
            const newCache: typeof this.pricingCache = {};
            models.forEach((model: any) => {
                if (model.id && model.pricing) {
                    newCache[model.id] = {
                        pricing: {
                            prompt: parseFloat(model.pricing.prompt) || 0,
                            completion: parseFloat(model.pricing.completion) || 0,
                        },
                    };
                }
            });
            this.pricingCache = newCache;
            this.pricingCacheTimestamp = now;
            console.log(`>>> Cached pricing for ${Object.keys(newCache).length} OpenRouter models.`);
        } catch (error: any) {
            console.error('Failed to fetch OpenRouter pricing:', error.message);
        }
    }

    private async calculateCost(model: string, promptTokens: number, completionTokens: number): Promise<number | null> {
        const routeConfig = this.modelRoutingConfig[model];
        if (routeConfig?.useOpenRouter && routeConfig.openRouterModelId) {
            const modelPricing = this.pricingCache[routeConfig.openRouterModelId];
            if (modelPricing?.pricing) {
                const cost = (promptTokens * modelPricing.pricing.prompt) + (completionTokens * modelPricing.pricing.completion);
                return parseFloat(cost.toFixed(6));
            }
        }
        return null;
    }

    private async logUsage(userId: string, model: string, assistantContent: string, provider: string, usage?: z.infer<typeof openAIUsageSchema>) {
        let promptTokens = usage?.prompt_tokens || 0;
        let completionTokens = usage?.completion_tokens || 0;

        // Fallback token calculation if not provided by API
        // NOTE: This is a rough estimation
        if (promptTokens === 0) {
           // This requires messages, which we don't have here. Needs refactoring to pass messages in.
        }
        if (completionTokens === 0) {
            completionTokens = Math.ceil(assistantContent.split(' ').length / 0.75);
        }
        const totalTokens = promptTokens + completionTokens;

        const cost = await this.calculateCost(model, promptTokens, completionTokens);
        if(cost) {
            costLimiterService.addCost(cost);
        }

        const { error: usageError } = await this.supabase.from('usage_logs').insert({
            user_id: userId,
            model: model,
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
            status: 'success',
            cost: cost,
        });

        if (usageError) {
            console.error('Failed to log usage:', usageError);
        }
        
        return { cost };
    }
}

export default ChatService;
