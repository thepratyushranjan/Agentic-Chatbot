import { NextResponse } from 'next/server';
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';

export async function POST(req) {
  try {
    const { query } = await req.json();

    if (typeof query !== 'string' || query.trim().length === 0) {
      return NextResponse.json({ error: 'Invalid "query" provided' }, { status: 400 });
    }

    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      return NextResponse.json(
        { error: 'Server misconfiguration: GOOGLE_GENERATIVE_AI_API_KEY is not set' },
        { status: 500 }
      );
    }

    const modelName = process.env.GOOGLE_GEMINI_MODEL || 'gemini-2.5-pro';
    const model = google(modelName);
    const { text } = await generateText({ model, prompt: query });

    return NextResponse.json({ result: text });
  } catch (error) {
    console.error('Error processing the request:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
} 