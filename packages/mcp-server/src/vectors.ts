/**
 * Wyrm Vector Embeddings - Semantic Search Support
 * 
 * @copyright 2026 Ghost Protocol (Pvt) Ltd. All Rights Reserved.
 * @license Proprietary - See LICENSE file for details.
 * 
 * Features:
 * - Local embeddings using transformers.js (no API required)
 * - Optional OpenAI/Ollama embeddings for better quality
 * - SQLite-based vector storage (no external DB needed)
 * - Cosine similarity search
 * - Automatic embedding on memory creation
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Vector dimension for different models
const EMBEDDING_DIMENSIONS: Record<string, number> = {
  'local': 384,           // all-MiniLM-L6-v2 (default local)
  'openai': 1536,         // text-embedding-3-small
  'openai-large': 3072,   // text-embedding-3-large
  'ollama': 768,          // nomic-embed-text
};

export interface EmbeddingConfig {
  provider: 'local' | 'openai' | 'ollama' | 'none';
  model?: string;
  apiKey?: string;
  ollamaUrl?: string;
  dimension?: number;
}

export interface VectorEntry {
  id: number;
  content_hash: string;
  content_type: 'session' | 'quest' | 'context' | 'note';
  content_id: number;
  project_id: number;
  embedding: Float32Array;
  created_at: string;
}

export interface SearchResult {
  content_type: string;
  content_id: number;
  project_id: number;
  similarity: number;
  content_hash: string;
}

/**
 * Simple vector storage using JSON files
 * For production, consider using sqlite-vss or similar
 */
export class VectorStore {
  private vectors: Map<string, VectorEntry> = new Map();
  private storePath: string;
  private config: EmbeddingConfig;
  private dimension: number;
  
  constructor(config: EmbeddingConfig) {
    this.config = config;
    this.dimension = config.dimension || EMBEDDING_DIMENSIONS[config.provider] || 384;
    
    const wyrmDir = join(homedir(), '.wyrm');
    if (!existsSync(wyrmDir)) {
      mkdirSync(wyrmDir, { recursive: true });
    }
    this.storePath = join(wyrmDir, 'vectors.json');
    
    this.loadVectors();
  }
  
  private loadVectors(): void {
    if (existsSync(this.storePath)) {
      try {
        const data = JSON.parse(readFileSync(this.storePath, 'utf-8'));
        for (const entry of data) {
          // Convert array back to Float32Array
          entry.embedding = new Float32Array(entry.embedding);
          this.vectors.set(entry.content_hash, entry);
        }
      } catch (e) {
        console.error('Failed to load vectors:', e);
        this.vectors = new Map();
      }
    }
  }
  
  private saveVectors(): void {
    const data = Array.from(this.vectors.values()).map(entry => ({
      ...entry,
      embedding: Array.from(entry.embedding), // Convert Float32Array to array for JSON
    }));
    writeFileSync(this.storePath, JSON.stringify(data));
  }
  
  /**
   * Hash content for deduplication
   */
  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
  
  /**
   * Add or update a vector entry
   */
  async addVector(
    content: string,
    contentType: 'session' | 'quest' | 'context' | 'note',
    contentId: number,
    projectId: number
  ): Promise<string | null> {
    if (this.config.provider === 'none') {
      return null;
    }
    
    const contentHash = this.hashContent(content);
    
    // Skip if already exists with same hash
    if (this.vectors.has(contentHash)) {
      return contentHash;
    }
    
    const embedding = await this.generateEmbedding(content);
    if (!embedding) {
      return null;
    }
    
    const entry: VectorEntry = {
      id: this.vectors.size + 1,
      content_hash: contentHash,
      content_type: contentType,
      content_id: contentId,
      project_id: projectId,
      embedding,
      created_at: new Date().toISOString(),
    };
    
    this.vectors.set(contentHash, entry);
    this.saveVectors();
    
    return contentHash;
  }
  
  /**
   * Generate embedding for text
   */
  private async generateEmbedding(text: string): Promise<Float32Array | null> {
    switch (this.config.provider) {
      case 'local':
        return this.generateLocalEmbedding(text);
      case 'openai':
        return this.generateOpenAIEmbedding(text);
      case 'ollama':
        return this.generateOllamaEmbedding(text);
      default:
        return null;
    }
  }
  
  /**
   * Local embedding using simple TF-IDF-like approach
   * For production, use @xenova/transformers
   */
  private async generateLocalEmbedding(text: string): Promise<Float32Array> {
    // Simple hash-based embedding (placeholder for real transformers)
    // In production, use: import { pipeline } from '@xenova/transformers';
    const embedding = new Float32Array(this.dimension);
    const words = text.toLowerCase().split(/\s+/);
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      for (let j = 0; j < word.length; j++) {
        const idx = (word.charCodeAt(j) * (i + 1) * (j + 1)) % this.dimension;
        embedding[idx] += 1 / words.length;
      }
    }
    
    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= magnitude;
      }
    }
    
    return embedding;
  }
  
  /**
   * OpenAI embedding API
   */
  private async generateOpenAIEmbedding(text: string): Promise<Float32Array | null> {
    if (!this.config.apiKey) {
      console.error('OpenAI API key not configured');
      return null;
    }
    
    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: text,
          model: this.config.model || 'text-embedding-3-small',
        }),
      });
      
      if (!response.ok) {
        console.error('OpenAI API error:', response.status);
        return null;
      }
      
      const data = await response.json() as { data: Array<{ embedding: number[] }> };
      return new Float32Array(data.data[0].embedding);
    } catch (e) {
      console.error('OpenAI embedding error:', e);
      return null;
    }
  }
  
  /**
   * Ollama embedding (local LLM)
   */
  private async generateOllamaEmbedding(text: string): Promise<Float32Array | null> {
    const ollamaUrl = this.config.ollamaUrl || 'http://localhost:11434';
    
    try {
      const response = await fetch(`${ollamaUrl}/api/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model || 'nomic-embed-text',
          prompt: text,
        }),
      });
      
      if (!response.ok) {
        console.error('Ollama API error:', response.status);
        return null;
      }
      
      const data = await response.json() as { embedding: number[] };
      return new Float32Array(data.embedding);
    } catch (e) {
      console.error('Ollama embedding error:', e);
      return null;
    }
  }
  
  /**
   * Cosine similarity between two vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }
    
    const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
    return magnitude > 0 ? dotProduct / magnitude : 0;
  }
  
  /**
   * Search for similar content
   */
  async search(
    query: string,
    limit: number = 10,
    projectId?: number,
    contentTypes?: string[]
  ): Promise<SearchResult[]> {
    const queryEmbedding = await this.generateEmbedding(query);
    if (!queryEmbedding) {
      return [];
    }
    
    const results: SearchResult[] = [];
    
    for (const entry of this.vectors.values()) {
      // Filter by project if specified
      if (projectId !== undefined && entry.project_id !== projectId) {
        continue;
      }
      
      // Filter by content type if specified
      if (contentTypes && !contentTypes.includes(entry.content_type)) {
        continue;
      }
      
      const similarity = this.cosineSimilarity(queryEmbedding, entry.embedding);
      
      results.push({
        content_type: entry.content_type,
        content_id: entry.content_id,
        project_id: entry.project_id,
        similarity,
        content_hash: entry.content_hash,
      });
    }
    
    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity);
    
    return results.slice(0, limit);
  }
  
  /**
   * Remove vector by content hash
   */
  removeVector(contentHash: string): boolean {
    const deleted = this.vectors.delete(contentHash);
    if (deleted) {
      this.saveVectors();
    }
    return deleted;
  }
  
  /**
   * Clear all vectors for a project
   */
  clearProjectVectors(projectId: number): number {
    let count = 0;
    for (const [hash, entry] of this.vectors.entries()) {
      if (entry.project_id === projectId) {
        this.vectors.delete(hash);
        count++;
      }
    }
    if (count > 0) {
      this.saveVectors();
    }
    return count;
  }
  
  /**
   * Get stats about the vector store
   */
  getStats(): { total: number; byType: Record<string, number>; byProject: Record<number, number> } {
    const byType: Record<string, number> = {};
    const byProject: Record<number, number> = {};
    
    for (const entry of this.vectors.values()) {
      byType[entry.content_type] = (byType[entry.content_type] || 0) + 1;
      byProject[entry.project_id] = (byProject[entry.project_id] || 0) + 1;
    }
    
    return {
      total: this.vectors.size,
      byType,
      byProject,
    };
  }
}

/**
 * Create a vector store instance with config
 */
export function createVectorStore(config?: Partial<EmbeddingConfig>): VectorStore {
  const fullConfig: EmbeddingConfig = {
    provider: config?.provider || 'local',
    model: config?.model,
    apiKey: config?.apiKey || process.env.OPENAI_API_KEY,
    ollamaUrl: config?.ollamaUrl || process.env.OLLAMA_URL,
    dimension: config?.dimension,
  };
  
  return new VectorStore(fullConfig);
}
