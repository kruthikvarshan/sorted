/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Decision, Commitment, Conflict, Message } from '../types/groupOs';

export interface MetaApiCallResult<T> {
  success: boolean;
  data?: T;
  rawText?: string;
  error?: string;
  modelUsed: string;
  timestamp: string;
}

export interface TranscriptTurn {
  speaker?: string;
  text: string;
  startMs: number;
  endMs: number;
}

export interface TranscriptionResult {
  transcript: string;
  turns: TranscriptTurn[];
  audioDurationMs: number;
}

export class MetaApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'MetaApiError';
  }
}

export class MetaModelService {
  /** The browser talks to the app's own forwarder. The eval script points this at Meta directly. */
  public static baseUrl = '/meta-proxy';
  public static DEFAULT_MODEL = 'muse-spark-1.3';
  // Names taken from the hackathon model catalog; confirm with listModels() against your key.
  public static IMAGE_MODEL = 'muse-image-1.0';
  public static TRANSCRIBE_MODEL = 'muse-voice-transcribe-1.0';

  /**
   * POST to Meta's OpenAI-compatible chat endpoint (via the /meta-proxy route to avoid CORS)
   * and return the parsed JSON. Never logs request or response bodies.
   */
  static reasoningEffortSupported = true;

  static async chatRaw(
    apiKey: string,
    body: Record<string, any>,
    options?: { reasoningEffort?: 'minimal' | 'low' | 'medium' }
  ): Promise<any> {
    // Muse Spark reasons before answering and that counts against max_tokens, so callers can ask for less of it.
    // If the endpoint rejects the parameter, stop sending it and retry once.
    const withEffort = !!options?.reasoningEffort && this.reasoningEffortSupported;
    try {
      return await this.postChat(apiKey, withEffort ? { ...body, reasoning_effort: options!.reasoningEffort } : body);
    } catch (err) {
      if (withEffort && err instanceof MetaApiError && (err.status === 400 || err.status === 422) && /reasoning/i.test(err.message)) {
        this.reasoningEffortSupported = false;
        return this.postChat(apiKey, body);
      }
      throw err;
    }
  }

  private static async postChat(apiKey: string, body: Record<string, any>): Promise<any> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      let errorMsg = `Meta API error (${response.status})`;
      try {
        const parsed = JSON.parse(errText);
        errorMsg = parsed.error?.message || parsed.message || errText;
      } catch {
        errorMsg = errText || `HTTP ${response.status} from Meta API`;
      }
      throw new MetaApiError(errorMsg, response.status);
    }

    return response.json();
  }

  /** Model ids the key can use, so IDs are verified rather than assumed. */
  static async listModels(apiKey: string): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
    });
    if (!response.ok) {
      throw new MetaApiError(`Could not list models (HTTP ${response.status})`, response.status);
    }
    const json = await response.json();
    const rows: any[] = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
    return rows.map(r => (typeof r === 'string' ? r : r.id)).filter(Boolean);
  }

  static messageText(content: unknown): string | undefined {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const text = content.map((p: any) => (typeof p === 'string' ? p : p?.text || '')).join('');
      return text || undefined;
    }
    return undefined;
  }

  static async callChatCompletion(
    apiKey: string,
    messages: { role: 'system' | 'user' | 'assistant'; content: any }[],
    options?: {
      model?: string;
      temperature?: number;
      max_tokens?: number;
      jsonMode?: boolean;
      isRetry?: boolean;
      reasoningEffort?: 'minimal' | 'low' | 'medium';
    }
  ): Promise<string> {
    const model = options?.model || this.DEFAULT_MODEL;

    const bodyPayload: Record<string, any> = {
      model,
      messages,
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.max_tokens ?? 8000,
    };

    if (options?.jsonMode) {
      bodyPayload.response_format = { type: 'json_object' };
    }

    const json = await this.chatRaw(apiKey, bodyPayload, { reasoningEffort: options?.reasoningEffort ?? 'low' });

    let content: string | undefined;

    if (Array.isArray(json.choices) && json.choices.length > 0) {
      const choice = json.choices[0];
      content = this.messageText(choice?.message?.content) || choice?.text || this.messageText(choice?.delta?.content);

      if (!content && choice?.finish_reason === 'length') {
        // muse-spark is a reasoning model: it can spend the whole budget thinking. Retry once, tersely.
        if (!options?.isRetry) {
          const lastMsg = messages[messages.length - 1]?.content;
          const userQueryText = typeof lastMsg === 'string' ? lastMsg : JSON.stringify(lastMsg);
          return await this.callChatCompletion(
            apiKey,
            [
              {
                role: 'system',
                content: 'You are Group OS. Answer the user directly in 2 to 3 sentences with exact evidence IDs [m_...]. Be concise.',
              },
              { role: 'user', content: userQueryText.slice(-1200) },
            ],
            { model, temperature: 0.1, max_tokens: 4096, isRetry: true }
          );
        }
        throw new Error(
          `Meta API hit max token ceiling (${json.usage?.completion_tokens || options?.max_tokens || 4096} tokens) during reasoning. Try asking a more specific question.`
        );
      }

      // Internal reasoning is never shown to the user as if it were the answer.
      if (!content && (choice?.message?.reasoning_content || choice?.message?.reasoning)) {
        throw new Error(
          `Meta model returned only internal reasoning and no answer (finish_reason: ${choice?.finish_reason || 'unknown'}).`
        );
      }
    } else if (json.message?.content) {
      content = json.message.content;
    } else if (json.data?.[0]?.content || json.data?.[0]?.text) {
      content = json.data[0].content || json.data[0].text;
    } else if (typeof json.output === 'string') {
      content = json.output;
    } else if (typeof json.response === 'string') {
      content = json.response;
    }

    if (!content || typeof content !== 'string') {
      throw new Error(`Meta API returned empty content or a non-standard response (HTTP 200, keys: ${Object.keys(json).join(', ')}).`);
    }

    return content;
  }

  /**
   * Real LLM query answering: Uses Meta's muse-spark-1.3 to answer user questions
   * about group decisions, budget calculations, commitments, and conflict status.
   */
  static async askGroupOsWithMeta(
    apiKey: string,
    query: string,
    context: {
      workspaceTitle: string;
      messages: Message[];
      decisions: Decision[];
      commitments: Commitment[];
      conflicts: Conflict[];
      otherWorkspacesSummary?: Array<{
        title: string;
        keyDecisions: string;
        activeConflicts: string;
      }>;
    },
    model: string = this.DEFAULT_MODEL
  ): Promise<MetaApiCallResult<string>> {
    const transcriptSnippet = context.messages
      .slice(-15)
      .map(m => `[${m.id}] ${m.speakerName}: "${m.content}"`)
      .join('\n');

    const decisionsSnippet = context.decisions
      .map(d => `- ${d.topic}: ${d.currentValue} [Status: ${d.status}]`)
      .join('\n');

    const commitmentsSnippet = context.commitments
      .map(c => `- ${c.ownerName}: ${c.description} [Status: ${c.status}]`)
      .join('\n');

    const conflictsSnippet = context.conflicts
      .filter(c => c.status === 'open')
      .map(c => `- CONFLICT on "${c.topic}": ${c.description}`)
      .join('\n');

    const otherWorkspacesSnippet = context.otherWorkspacesSummary && context.otherWorkspacesSummary.length > 0
      ? context.otherWorkspacesSummary
          .map(w => `WORKSPACE: "${w.title}"\nDecisions: ${w.keyDecisions}\nConflicts: ${w.activeConflicts}`)
          .join('\n\n')
      : '';

    const systemPrompt = `You are Group OS, an evidence-backed intelligence assistant powered by Meta's ${model}.
You are currently focused on the active workspace: "${context.workspaceTitle}".

CRITICAL MULTI-WORKSPACE REASONING RULES:
1. Every claim must cite evidence IDs in square brackets (e.g. [m_proj_01], [m_goa_04], [m_flat_01], [att_hotel_booking]).
2. If the user's question relates to the CURRENT workspace ("${context.workspaceTitle}"), answer directly from its messages, decisions, and conflicts.
3. If the user asks about a topic belonging to ANOTHER workspace (for example, asking about "release blockers", "Nov 4 deadline", "sprint PRs", "departure conflict", "hotel booking", or "rent/bills" while viewing a different group):
   - Intelligently clarify which workspace tracks this topic.
   - IMMEDIATELY PROVIDE the full, grounded answer from that other workspace with its citations! (e.g. "In your 'Sprint 14: Meta Hackathon Delivery' workspace, the key blockers before Nov 4, 9:00 PM ET are [m_proj_01]...").
4. If there is a contradiction in plans, explicitly highlight the conflict and its financial or schedule impact. Never silently overwrite.
5. CONCISENESS MANDATE: Do not generate a lengthy internal chain of thought. Output your final answer directly in 2 to 4 clear, authoritative sentences citing exact evidence IDs.`;

    const userPrompt = `ACTIVE WORKSPACE ("${context.workspaceTitle}") STATE:
DECISIONS:
${decisionsSnippet || 'None'}

COMMITMENTS:
${commitmentsSnippet || 'None'}

ACTIVE CONFLICTS:
${conflictsSnippet || 'None'}

RECENT MESSAGES:
${transcriptSnippet}

${otherWorkspacesSnippet ? `OTHER USER WORKSPACES IN GROUP OS:\n${otherWorkspacesSnippet}\n` : ''}
USER QUESTION: "${query}"

Provide an accurate, grounded answer with exact citations:`;

    try {
      const answer = await this.callChatCompletion(
        apiKey,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { model, temperature: 0.2, max_tokens: 4096 }
      );

      return {
        success: true,
        data: answer.trim(),
        modelUsed: model,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        modelUsed: model,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Private assistant: answers about ONE person's commitments, using only the groups they put in scope.
   */
  static async askPrivateAssistantWithMeta(
    apiKey: string,
    query: string,
    context: {
      userName: string;
      groups: { title: string; decisions: string; myCommitments: string; openConflicts: string }[];
      /** Money worked out in code. The model quotes it and never adds anything up itself. */
      money?: { totalsText: string; owedText?: string; lines: string[] };
    },
    model: string = this.DEFAULT_MODEL
  ): Promise<MetaApiCallResult<string>> {
    const groups = context.groups
      .map(g => `GROUP "${g.title}"\nDecisions: ${g.decisions}\n${context.userName}'s commitments: ${g.myCommitments}\nOpen conflicts: ${g.openConflicts}`)
      .join('\n\n');

    try {
      const answer = await this.callChatCompletion(
        apiKey,
        [
          {
            role: 'system',
            content: `You are the private assistant for ${context.userName}, powered by Meta ${model}. Answer only from the groups and the money summary below; if the answer is not there, say so plainly. Never invent commitments, dates or amounts.
Money: the "Money summary" was worked out by the app and is exact. Quote its totals as given and never add or subtract numbers yourself. Amounts are already netted inside each group (what others owe back is deducted) and never netted between groups: keep the groups separate. A line saying something is "not counted yet" is waiting for the group to agree, so do not count it. If the summary says "nothing", say nothing is owed.
Put the group name in square brackets when you mention a group. Answer in 2 to 5 short sentences.`,
          },
          {
            role: 'user',
            content: `${groups || 'No groups are in scope.'}\n\nMoney summary (exact)\nTotal ${context.userName} still owes: ${context.money?.totalsText ?? 'not computed'}\nTotal ${context.userName} is owed by others: ${context.money?.owedText ?? 'not computed'}\n${(context.money?.lines ?? []).map(l => `- ${l}`).join('\n') || '- none'}\n\nQuestion: ${query}`,
          },
        ],
        { model, temperature: 0.2 }
      );
      return { success: true, data: answer.trim(), modelUsed: model, timestamp: new Date().toISOString() };
    } catch (err: any) {
      return { success: false, error: err.message, modelUsed: model, timestamp: new Date().toISOString() };
    }
  }

  /**
   * Meta Image Generation API (muse-image-1.0):
   * Generates trip visuals, villa previews, or itinerary hero cards.
   */
  static async generateImageWithMeta(
    apiKey: string,
    prompt: string,
    options?: { model?: string; size?: string }
  ): Promise<MetaApiCallResult<string>> {
    const model = options?.model || this.IMAGE_MODEL;

    try {
      const response = await fetch(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          size: options?.size || '1024x1024',
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Meta muse-image-1.0 error (${response.status}): ${errText}`);
      }

      const json = await response.json();
      const imageUrl = json.data?.[0]?.url || json.data?.[0]?.b64_json;
      if (!imageUrl) {
        throw new Error('No image URL returned from Meta muse-image-1.0 API');
      }

      return {
        success: true,
        data: imageUrl.startsWith('http') || imageUrl.startsWith('data:') ? imageUrl : `data:image/png;base64,${imageUrl}`,
        modelUsed: model,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        modelUsed: model,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Meta Muse Voice Transcribe: POST /v1/asr/transcribe, multipart with a JSON `request` part
   * and a mono 16-bit WAV `audio` part (16 or 24 kHz, max 10 minutes).
   * DIARIZATION mode labels speakers per turn.
   */
  static async transcribeAudioWithMeta(
    apiKey: string,
    wav: Blob,
    options?: { diarize?: boolean; languageBias?: string[]; keywords?: string[] }
  ): Promise<MetaApiCallResult<TranscriptionResult>> {
    const model = this.TRANSCRIBE_MODEL;
    try {
      const form = new FormData();
      form.append(
        'request',
        new Blob(
          [
            JSON.stringify({
              model,
              audioEncoding: 'WAV',
              mode: options?.diarize ? 'DIARIZATION' : 'PUSH_TO_TALK',
              ...(options?.languageBias?.length ? { languageBias: options.languageBias } : {}),
              ...(options?.keywords?.length ? { keywords: options.keywords } : {}),
            }),
          ],
          { type: 'application/json' }
        )
      );
      form.append('audio', wav, 'voice_note.wav');

      const response = await fetch(`${this.baseUrl}/asr/transcribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: 'application/json' },
        body: form,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Meta voice transcription error (${response.status}): ${errText.slice(0, 300)}`);
      }

      const json = await response.json();
      if (typeof json.transcript !== 'string') {
        throw new Error('Transcription response had no transcript field.');
      }

      return {
        success: true,
        data: {
          transcript: json.transcript.trim(),
          audioDurationMs: Number(json.audioDurationMs) || 0,
          turns: (Array.isArray(json.turns) ? json.turns : []).map((t: any) => ({
            speaker: t.speaker,
            text: String(t.transcript ?? ''),
            startMs: Number(t.startMs) || 0,
            endMs: Number(t.endMs) || 0,
          })),
        },
        modelUsed: model,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      return { success: false, error: err.message, modelUsed: model, timestamp: new Date().toISOString() };
    }
  }

  /**
   * Multimodal Vision API (OCR for bills, booking PDFs, receipts)
   */
  static async analyzeDocumentImageWithMeta(
    apiKey: string,
    imageBase64OrUrl: string,
    documentType: 'receipt' | 'booking' | 'bill'
  ): Promise<MetaApiCallResult<{ summary: string; extractedAmountINR?: number; date?: string; nonRefundable?: boolean }>> {
    const prompt = `Analyze this ${documentType} image. Extract:
1. Vendor / Provider name
2. Total amount in INR
3. Date or booking period
4. Cancellation policy: is it non-refundable? (true/false)
5. A concise 2-sentence summary.
Return JSON: { "summary": string, "extractedAmountINR": number, "date": string, "nonRefundable": boolean }`;

    try {
      const content = await this.callChatCompletion(
        apiKey,
        [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageBase64OrUrl } },
            ],
          },
        ],
        { model: this.DEFAULT_MODEL, temperature: 0.1 }
      );

      const cleanJson = content.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      return {
        success: true,
        data: parsed,
        rawText: content,
        modelUsed: this.DEFAULT_MODEL,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        modelUsed: this.DEFAULT_MODEL,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
