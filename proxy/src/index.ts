/// <reference path="./types/express.d.ts" />

// Load environment variables FIRST, before any other imports
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

// Configs
import { CORS_OPTIONS } from './config/cors';
import { LIMITS } from './config/limits';

// Middleware
import { createAuthMiddleware, requireAdmin } from './middleware/auth';
import { chatLimiter } from './middleware/rateLimiter';

// Routes
import chatRoutes from './routes/v1/chat';
import modelRoutes from './routes/v1/models';
import adminRoutes from './routes/v1/admin';
import settingsRoutes from './routes/v1/settings';
import publicSettingsRoutes from './routes/v1/public-settings';
import ragRoutes from './routes/v1/rag';

// Services
import ChatService from './services/chatService';
import CloudRuTokenService from './services/CloudRuTokenService';

async function main() {
    const port = process.env.PORT || 3000;

    // 1. Setup Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceRoleKey) {
        console.error('Supabase environment variables are not set.');
        process.exit(1);
    }
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    console.log("Supabase client created.");

    // 2. Preload critical services
    const chatService = new ChatService(supabase);
    // Wait for critical data to load before starting the server
    await chatService.loadModelRoutingConfig();
    await chatService.fetchOpenRouterPricing();
    
    // Preload Cloud.ru access token
    const tokenService = CloudRuTokenService.getInstance();
    try {
        await tokenService.getAccessToken();
        console.log("Cloud.ru access token obtained.");
    } catch (error) {
        console.warn("Failed to obtain Cloud.ru access token on startup. Will retry on first RAG request.");
    }
    
    console.log("Critical services preloaded.");

    // 3. Create Express App
    const app = express();

    // Trust proxy headers (X-Forwarded-For, X-Forwarded-Proto) from Nginx
    // Required for correct IP detection in rate limiting
    app.set('trust proxy', 1);

    app.use(cors(CORS_OPTIONS));
    app.use(express.json({ limit: `${LIMITS.MAX_MESSAGE_SIZE_BYTES}b` }));

    // Create auth middleware instance
    const authenticateUser = createAuthMiddleware(supabase);

    // 4. Define Routes
    app.get('/api/health', (req, res) => res.status(200).send('Proxy server is running'));

    // Public routes (no auth required)
    app.use('/api/v1', modelRoutes(supabase));
    app.use('/api/v1', publicSettingsRoutes(supabase)); // GET settings (public)
    
    // Authenticated routes
    app.use('/api/v1', authenticateUser); // All subsequent routes require a valid user
    
    // Settings routes (PUT requires auth+admin)
    app.use('/api/v1', settingsRoutes(supabase));
    
    // Admin routes (require admin role) - NO rate limiting
    console.log("Mounting admin routes at /api/v1/admin");
    app.use('/api/v1/admin', adminRoutes(supabase));

    // Chat routes (add specific limiter)
    app.use('/api/v1/chat', chatLimiter, chatRoutes(supabase, chatService));
    
    // RAG routes (authenticated, with chat limiter)
    app.use('/api/v1/chat/rag', chatLimiter, ragRoutes(supabase, chatService));

    console.log("Routes defined.");

    // 5. Start Server
    app.listen(port, () => {
        console.log(`✅ Proxy server is running and listening at http://localhost:${port}`);
    });
}

main().catch(error => {
    console.error('💥 Failed to start proxy server:', error);
    process.exit(1);
});
