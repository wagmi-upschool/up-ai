// routes/reflectionRoutes.js
import express from 'express';
import {
    handleReflection,
    handleReflectionStream
} from '../controllers/reflectionController.js';

const router = express.Router();
router.post('/user/:userId/conversation/:conversationId/reflection', handleReflection);
router.post('/user/:userId/conversation/:conversationId/reflection/stream', handleReflectionStream);

export default router; // Change this to a default export