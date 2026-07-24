// lib/tokens.js
import { randomBytes } from 'node:crypto';

export const randomToken = () => randomBytes(32).toString('hex');
export const randomId = () => randomBytes(16).toString('hex');
export const now = () => Date.now();
