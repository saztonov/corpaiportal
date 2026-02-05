import { z } from 'zod';
import { LIMITS } from '../config/limits';

const attachmentSchema = z.object({
    type: z.enum(['image', 'pdf', 'markdown']),
    name: z.string().min(1).max(255),
    mime_type: z.string().min(1).max(100),
    size: z.number().int().positive().max(20 * 1024 * 1024), // 20MB max per file
    data: z.string().min(1),
});

export const chatRequestSchema = z.object({
    model: z.string().min(1, 'Model is required.'),
    messages: z.array(z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string().min(1, 'Message content is required.').max(LIMITS.MAX_MESSAGE_CONTENT_LENGTH, `Message content exceeds maximum size of ${LIMITS.MAX_MESSAGE_CONTENT_LENGTH} characters.`),
        attachments: z.array(attachmentSchema).max(5).optional(),
    })).min(1, 'Messages must be a non-empty array.').max(LIMITS.MAX_MESSAGES_PER_REQUEST, `Maximum ${LIMITS.MAX_MESSAGES_PER_REQUEST} messages allowed per request.`),
    conversationId: z.string().uuid().nullable().optional(),
    temperature: z.number().min(0).max(2).nullable().optional(),
    top_p: z.number().min(0).max(1).nullable().optional(),
});

export type ChatRequestPayload = z.infer<typeof chatRequestSchema>;
