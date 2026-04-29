'use client';

import { use, useState, useMemo, useEffect } from 'react';
import useSWR from 'swr';
import { useSessionDetail } from '@/lib/hooks';
import { useCostMode } from '@/lib/cost-mode-context';
import { SessionMessageDisplay } from '@/lib/claude-data/types';
import { formatCost, formatDuration, formatTokens } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft, Clock, GitBranch, MessageSquare, Wrench,
  User, Bot, Coins, Activity, Minimize2, ChevronDown, ChevronRight,
  TrendingUp, Eye, X, Layers
} from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell as BarCell
} from 'recharts';

SyntaxHighlighter.registerLanguage('json', json);

const TOKEN_COLORS = {
  input: 'var(--chart-1)',
  output: 'var(--chart-2)',
  cacheRead: 'var(--chart-4)',
  cacheWrite: 'var(--chart-5)',
};

const customCodeStyle: { [key: string]: React.CSSProperties } = {
// ... (rest of style)
  'code[class*="language-"]': {
    color: '#abb2bf',
    background: 'none',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '12px',
    textAlign: 'left',
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    wordWrap: 'normal',
    lineHeight: '1.5',
    tabSize: 2,
    hyphens: 'none',
  },
  'pre[class*="language-"]': {
    color: '#abb2bf',
    background: 'transparent',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '12px',
    textAlign: 'left',
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    wordWrap: 'normal',
    lineHeight: '1.5',
    tabSize: 2,
    hyphens: 'none',
    padding: '0',
    margin: '0',
    overflow: 'auto',
  },
  '.token.property': { color: '#e06c75' },
  '.token.string': { color: '#98c379' },
  '.token.number': { color: '#d19a66' },
  '.token.boolean': { color: '#56b6c2' },
  '.token.punctuation': { color: '#abb2bf' },
};

function ToolCall({ tool }: { tool: { name: string; id: string; input?: unknown } }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="mt-1 flex flex-col items-start">
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 rounded border border-border bg-background px-2 py-0.5 text-[10px] font-mono hover:bg-accent transition-colors"
      >
        <Wrench className="h-3 w-3 text-muted-foreground" />
        <span>{tool.name}</span>
        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {isExpanded && tool.input !== undefined && (
        <pre className="mt-1 w-full p-2 bg-muted/50 rounded text-[10px] overflow-x-auto font-mono border border-border/30">
          {JSON.stringify(tool.input, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session, isLoading, error } = useSessionDetail(id);
  const { pickCost } = useCostMode();
  const [selectedJson, setSelectedJson] = useState<SessionMessageDisplay | null>(null);
  const [groupMessages, setGroupMessages] = useState(true);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (highlightedIndex !== null) {
      const timer = setTimeout(() => setHighlightedIndex(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [highlightedIndex]);

  const displayMessages = useMemo(() => {
    if (!session?.messages) return [];
    
    const messages = groupMessages ? (() => {
      const grouped: (SessionMessageDisplay & { cacheReadDelta?: number; showCacheRead?: boolean })[] = [];
      let lastCacheRead = 0;

      session.messages.forEach((msg) => {
        const lastMsg = grouped.length > 0 ? grouped[grouped.length - 1] : null;
        const isSameRequest = lastMsg && msg.requestId && lastMsg.requestId === msg.requestId && msg.role === 'assistant' && lastMsg.role === 'assistant';

        const cacheRead = msg.usage?.cache_read_input_tokens || 0;
        let cacheReadDelta = 0;
        let showCacheRead = false;

        if (cacheRead > 0 && cacheRead > lastCacheRead) {
          cacheReadDelta = lastCacheRead > 0 ? cacheRead - lastCacheRead : 0;
          showCacheRead = true;
          lastCacheRead = cacheRead;
        }

        if (isSameRequest) {
          if (msg.content) {
            if (lastMsg.content.startsWith('[Used ') && lastMsg.content.includes('tool(s):')) {
              lastMsg.content = msg.content;
            } else {
              lastMsg.content = `${lastMsg.content}\n${msg.content}`;
            }
          }
          if (msg.toolCalls) {
            lastMsg.toolCalls = [...(lastMsg.toolCalls || []), ...msg.toolCalls];
            if (lastMsg.content.startsWith('[Used ') && lastMsg.content.includes('tool(s):')) {
              lastMsg.content = `[Used ${lastMsg.toolCalls.length} tool(s): ${lastMsg.toolCalls.map(t => t.name).join(', ')}]`;
            }
          }
          if (msg.usage) {
            lastMsg.usage = msg.usage;
            lastMsg.cacheReadDelta = cacheReadDelta || lastMsg.cacheReadDelta;
            lastMsg.showCacheRead = showCacheRead || lastMsg.showCacheRead;
          }
        } else {
          grouped.push({ ...msg, cacheReadDelta, showCacheRead });
        }
      });
      return grouped;
    })() : session.messages;

    // Calculate cumulative tokens
    let runningTotal = 0;
    return messages.map(msg => {
      const tokens = msg.usage ? (
        (msg.usage.input_tokens || 0) + 
        (msg.usage.output_tokens || 0) + 
        (msg.usage.cache_read_input_tokens || 0) + 
        (msg.usage.cache_creation_input_tokens || 0)
      ) : 0;
      
      // If we are NOT grouping, we need to be careful not to double count tokens from the same request
      // But for simplicity and based on user request "ten en cuenta los mensajes con el mismo id", 
      // let's assume each entry in 'messages' is a discrete unit of usage to display.
      // Actually, if NOT grouping, msg.usage in assistant messages of same request might be cumulative.
      // Let's stick to the grouped logic for running total if possible, or just sum them up.
      
      runningTotal += tokens;
      return { ...msg, cumulativeTokens: runningTotal };
    });
  }, [session, groupMessages]);

  const conversationChartData = useMemo(() => {
    return displayMessages.map((msg, i) => ({
      index: i + 1,
      input: msg.usage?.input_tokens || 0,
      output: msg.usage?.output_tokens || 0,
      cacheRead: msg.usage?.cache_read_input_tokens || 0,
      cacheWrite: msg.usage?.cache_creation_input_tokens || 0,
    }));
  }, [displayMessages]);

  if (isLoading || !session || !session.id) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="space-y-3 text-center">
          {error ? (
            <p className="text-sm text-muted-foreground">Session not found.</p>
          ) : (
            <>
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm text-muted-foreground">Loading session...</p>
            </>
          )}
        </div>
      </div>
    );
  }

  const topTools = Object.entries(session.toolsUsed || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const models = [...new Set(session.models || [])];
  const compaction = session.compaction || { compactions: 0, microcompactions: 0, totalTokensSaved: 0, compactionTimestamps: [] };
  const compactionCount = compaction.compactions + compaction.microcompactions;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/sessions"
          className="rounded-lg border border-border p-1.5 hover:bg-accent transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight">{session.projectName}</h1>
            {models.map(m => (
              <Badge key={m} variant="secondary" className="text-xs">
                {m}
              </Badge>
            ))}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
            <span className="font-mono">{session.id.slice(0, 8)}</span>
            {session.gitBranch && (
              <span className="flex items-center gap-1">
                <GitBranch className="h-3 w-3" />
                {session.gitBranch}
              </span>
            )}
            <span>{format(new Date(session.timestamp), 'MMM d, yyyy h:mm a')}</span>
          </div>
        </div>
      </div>

      {/* Session Stats */}
      <div className="grid grid-cols-6 gap-3">
        <Card className="border-border/50 shadow-sm">
          <CardContent className="p-3 text-center">
            <Clock className="h-3.5 w-3.5 mx-auto mb-1 text-muted-foreground" />
            <p className="text-lg font-bold">{formatDuration(session.duration)}</p>
            <p className="text-[10px] text-muted-foreground">Duration</p>
          </CardContent>
        </Card>
        <Card className="border-border/50 shadow-sm">
          <CardContent className="p-3 text-center">
            <MessageSquare className="h-3.5 w-3.5 mx-auto mb-1 text-muted-foreground" />
            <p className="text-lg font-bold">{session.messageCount}</p>
            <p className="text-[10px] text-muted-foreground">Messages</p>
          </CardContent>
        </Card>
        <Card className="border-border/50 shadow-sm">
          <CardContent className="p-3 text-center">
            <Wrench className="h-3.5 w-3.5 mx-auto mb-1 text-muted-foreground" />
            <p className="text-lg font-bold">{session.toolCallCount}</p>
            <p className="text-[10px] text-muted-foreground">Tool Calls</p>
          </CardContent>
        </Card>
        <Card className="border-border/50 shadow-sm">
          <CardContent className="p-3 text-center">
            <Activity className="h-3.5 w-3.5 mx-auto mb-1 text-muted-foreground" />
            <p className="text-lg font-bold">{formatTokens(session.totalInputTokens + session.totalOutputTokens)}</p>
            <p className="text-[10px] text-muted-foreground">Tokens</p>
          </CardContent>
        </Card>
        <Card className="border-border/50 shadow-sm">
          <CardContent className="p-3 text-center">
            <Coins className="h-3.5 w-3.5 mx-auto mb-1 text-muted-foreground" />
            <p className="text-lg font-bold">{formatCost(pickCost(session.estimatedCosts, session.estimatedCost))}</p>
            <p className="text-[10px] text-muted-foreground">Est. Usage</p>
          </CardContent>
        </Card>
        <Card className={`border-border/50 shadow-sm ${compactionCount > 0 ? 'border-amber-300/50 bg-amber-50/30' : ''}`}>
          <CardContent className="p-3 text-center">
            <Minimize2 className="h-3.5 w-3.5 mx-auto mb-1 text-muted-foreground" />
            <p className="text-lg font-bold">{compactionCount}</p>
            <p className="text-[10px] text-muted-foreground">Compactions</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Conversation */}
        <div className="col-span-2">
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-semibold">Conversation</CardTitle>
              <div className="flex items-center gap-2 px-2 py-1 bg-muted/40 rounded-md border border-border/50">
                <input 
                  type="checkbox"
                  id="group-toggle" 
                  checked={groupMessages} 
                  onChange={(e) => setGroupMessages(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary/20 cursor-pointer"
                />
                <label 
                  htmlFor="group-toggle" 
                  className="text-[10px] font-medium leading-none flex items-center gap-1 cursor-pointer select-none text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Layers className="h-3 w-3" />
                  Group by Request
                </label>
              </div>
            </CardHeader>
            <CardContent className="pt-0 max-h-[calc(100vh-280px)] overflow-y-auto">
              <div className="space-y-4">
                {displayMessages.map((msg, i) => {
                  const m = msg as (SessionMessageDisplay & { cacheReadDelta?: number; showCacheRead?: boolean });
                  const cacheRead = m.usage?.cache_read_input_tokens || 0;
                  const cacheReadDelta = m.cacheReadDelta || 0;
                  const showCacheRead = m.showCacheRead || false;
                  const cacheWrite = msg.usage?.cache_creation_input_tokens || 0;

                    return (
                      <div 
                        key={i} 
                        id={`msg-${i}`} 
                        className={`flex gap-3 scroll-mt-6 p-2 rounded-lg transition-all duration-500 ${
                          highlightedIndex === i 
                            ? 'bg-primary/5 ring-2 ring-primary shadow-md' 
                            : 'border-transparent'
                        }`}
                      >
                        <div className={`mt-0.5 flex-shrink-0 rounded-lg p-1.5 ${
                          msg.role === 'user' ? 'bg-primary/10' : 'bg-muted'
                        }`}>
                          {msg.role === 'user' ? (
                            <User className="h-3.5 w-3.5 text-primary" />
                          ) : (
                            <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium">
                              {msg.role === 'user' ? 'You' : 'Claude'}
                            </span>
                            {msg.type && msg.type !== msg.role && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0 uppercase tracking-tight font-semibold bg-muted/50 text-muted-foreground">
                                {msg.type}
                              </Badge>
                            )}
                            <span className="text-[10px] text-muted-foreground">
                              {format(new Date(msg.timestamp), 'h:mm:ss a')}
                            </span>
                            {msg.requestId && (
                              <span className="text-[9px] text-muted-foreground font-mono bg-muted/30 px-1 rounded" title={`Request ID: ${msg.requestId}`}>
                                req:{msg.requestId.split('_')[1]?.slice(0, 6) || msg.requestId.slice(0, 6)}
                              </span>
                            )}
                            {msg.messageId && (
                              <span className="text-[9px] text-muted-foreground font-mono bg-muted/30 px-1 rounded" title={`Message ID: ${msg.messageId}`}>
                                msg:{msg.messageId.split('_')[1]?.slice(0, 6) || msg.messageId.slice(0, 6)}
                              </span>
                            )}
                            {msg.model && (
                              <Badge variant="secondary" className="text-[9px] px-1 py-0">
                                {msg.model.includes('opus') ? 'Opus' : msg.model.includes('sonnet') ? 'Sonnet' : 'Haiku'}
                              </Badge>
                            )}
                            {msg.usage && (
                              <span className="text-[9px] text-muted-foreground">
                                {formatTokens((msg.usage.input_tokens || 0) + (msg.usage.output_tokens || 0) + (msg.usage.cache_read_input_tokens || 0) + (msg.usage.cache_creation_input_tokens || 0))} tokens
                              </span>
                            )}
                            <button
                              onClick={() => setSelectedJson(msg)}
                              className="ml-auto rounded-md p-1 hover:bg-muted text-muted-foreground transition-colors"
                              title="View message JSON"
                            >
                              <Eye className="h-3 w-3" />
                            </button>
                          </div>
                          <div className="text-sm text-foreground/90 whitespace-pre-wrap break-words leading-relaxed">
                            {msg.content.length > 500 ? msg.content.slice(0, 500) + '...' : msg.content}
                          </div>

                          {msg.usage && (
                            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <span className="font-semibold text-foreground/70">In:</span> {formatTokens(msg.usage.input_tokens)}
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="font-semibold text-foreground/70">Out:</span> {formatTokens(msg.usage.output_tokens)}
                              </div>
                              {showCacheRead && (
                                <div className="flex items-center gap-1 text-amber-700">
                                  <span className="font-semibold">Cache Read:</span> {formatTokens(cacheRead)}
                                  {cacheReadDelta > 0 && (
                                    <>
                                      <TrendingUp className="h-3 w-3 ml-0.5" />
                                      <span className="font-medium">{formatTokens(cacheReadDelta)}</span>
                                    </>
                                  )}
                                </div>
                              )}
                              {cacheWrite > 0 && (
                                <div className="flex items-center gap-1 text-sky-700">
                                  <span className="font-semibold">Cache Write:</span> {formatTokens(cacheWrite)}
                                </div>
                              )}
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <span className="font-semibold">Total:</span> {formatTokens(
                                  (msg.usage.input_tokens || 0) + 
                                  (msg.usage.output_tokens || 0) + 
                                  (msg.usage.cache_read_input_tokens || 0) + 
                                  (msg.usage.cache_creation_input_tokens || 0)
                                )}
                              </div>
                              <div className="flex items-center gap-1 text-muted-foreground ml-auto">
                                <span className="font-semibold">Cumulative:</span> {formatTokens(msg.cumulativeTokens || 0)}
                              </div>
                            </div>
                          )}

                          {msg.toolCalls && msg.toolCalls.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {msg.toolCalls.map((tool, j) => (
                                <ToolCall key={j} tool={tool} />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>

          {/* Conversation Usage Timeline */}
          <Card className="mt-4 border-border/50 shadow-sm overflow-hidden">
            <div className="h-[600px] w-full px-2 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart 
                  data={conversationChartData} 
                  margin={{ top: 0, right: 0, left: 0, bottom: 2 }}
                >
                  <Bar 
                    dataKey="input" 
                    stackId="a" 
                    fill={TOKEN_COLORS.input} 
                    onClick={(data) => {
                      const idx = data.index - 1;
                      setHighlightedIndex(idx);
                      const element = document.getElementById(`msg-${idx}`);
                      if (element) {
                        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                  <Bar 
                    dataKey="output" 
                    stackId="a" 
                    fill={TOKEN_COLORS.output} 
                    onClick={(data) => {
                      const idx = data.index - 1;
                      setHighlightedIndex(idx);
                      const element = document.getElementById(`msg-${idx}`);
                      if (element) {
                        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                  <Bar 
                    dataKey="cacheRead" 
                    stackId="a" 
                    fill={TOKEN_COLORS.cacheRead} 
                    onClick={(data) => {
                      const idx = data.index - 1;
                      setHighlightedIndex(idx);
                      const element = document.getElementById(`msg-${idx}`);
                      if (element) {
                        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                  <Bar 
                    dataKey="cacheWrite" 
                    stackId="a" 
                    fill={TOKEN_COLORS.cacheWrite} 
                    onClick={(data) => {
                      const idx = data.index - 1;
                      setHighlightedIndex(idx);
                      const element = document.getElementById(`msg-${idx}`);
                      if (element) {
                        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                  <RechartsTooltip
                    cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
                    wrapperStyle={{ pointerEvents: 'none' }}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="rounded-lg border border-border bg-card p-2 shadow-sm text-[10px] pointer-events-none">
                            <p className="font-bold mb-1">Message {payload[0].payload.index}</p>
                            <div className="space-y-0.5">
                              {payload.map((entry: any) => (
                                <div key={entry.name} className="flex items-center justify-between gap-4">
                                  <div className="flex items-center gap-1.5">
                                    <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: entry.color }} />
                                    <span className="text-muted-foreground capitalize">{entry.name}</span>
                                  </div>
                                  <span className="font-mono font-medium">{formatTokens(entry.value)}</span>
                                </div>
                              ))}
                            </div>
                            <p className="mt-2 text-[8px] text-muted-foreground italic">Click to jump to message</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-muted/30 border-t border-border/30 px-3 py-1.5 flex items-center justify-between gap-4">
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Conversation Token Flow</span>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TOKEN_COLORS.input }} />
                  <span className="text-[9px] text-muted-foreground">In</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TOKEN_COLORS.output }} />
                  <span className="text-[9px] text-muted-foreground">Out</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TOKEN_COLORS.cacheRead }} />
                  <span className="text-[9px] text-muted-foreground">C.Read</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TOKEN_COLORS.cacheWrite }} />
                  <span className="text-[9px] text-muted-foreground">C.Write</span>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Sidebar info */}
        <div className="space-y-4">
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Token Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              <div className="h-[140px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Input', value: session.totalInputTokens, color: TOKEN_COLORS.input },
                        { name: 'Output', value: session.totalOutputTokens, color: TOKEN_COLORS.output },
                        { name: 'Cache Read', value: session.totalCacheReadTokens, color: TOKEN_COLORS.cacheRead },
                        { name: 'Cache Write', value: session.totalCacheWriteTokens, color: TOKEN_COLORS.cacheWrite },
                      ].filter(d => d.value > 0)}
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={55}
                      dataKey="value"
                      strokeWidth={2}
                      stroke="var(--card)"
                    >
                      {[
                        { name: 'Input', value: session.totalInputTokens, color: TOKEN_COLORS.input },
                        { name: 'Output', value: session.totalOutputTokens, color: TOKEN_COLORS.output },
                        { name: 'Cache Read', value: session.totalCacheReadTokens, color: TOKEN_COLORS.cacheRead },
                        { name: 'Cache Write', value: session.totalCacheWriteTokens, color: TOKEN_COLORS.cacheWrite },
                      ].filter(d => d.value > 0).map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      formatter={(value) => formatTokens(Number(value))}
                      contentStyle={{
                        backgroundColor: 'var(--card)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        fontSize: '10px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: TOKEN_COLORS.input }} />
                    <span className="text-muted-foreground">Input Tokens</span>
                  </div>
                  <span className="font-medium">{formatTokens(session.totalInputTokens)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: TOKEN_COLORS.output }} />
                    <span className="text-muted-foreground">Output Tokens</span>
                  </div>
                  <span className="font-medium">{formatTokens(session.totalOutputTokens)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: TOKEN_COLORS.cacheRead }} />
                    <span className="text-muted-foreground">Cache Read</span>
                  </div>
                  <span className="font-medium">{formatTokens(session.totalCacheReadTokens)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: TOKEN_COLORS.cacheWrite }} />
                    <span className="text-muted-foreground">Cache Write</span>
                  </div>
                  <span className="font-medium">{formatTokens(session.totalCacheWriteTokens)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {topTools.length > 0 && (
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Tools Used</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {topTools.map(([tool, count]) => (
                  <div key={tool} className="flex items-center justify-between">
                    <span className="text-xs font-mono truncate max-w-[150px]">{tool}</span>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {count}x
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Compaction Details */}
          {compactionCount > 0 && (
            <Card className="border-amber-300/50 bg-amber-50/30 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <Minimize2 className="h-3.5 w-3.5" />
                  Context Compaction
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Full Compactions</span>
                  <span className="font-bold">{compaction.compactions}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Micro-compactions</span>
                  <span className="font-bold">{compaction.microcompactions}</span>
                </div>
                {compaction.totalTokensSaved > 0 && (
                  <>
                    <Separator />
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Tokens Saved</span>
                      <span className="font-bold text-green-600">
                        {formatTokens(compaction.totalTokensSaved)}
                      </span>
                    </div>
                  </>
                )}
                {(compaction.compactionTimestamps || []).length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground font-medium">Timeline</span>
                      {compaction.compactionTimestamps.map((ts, i) => (
                        <div key={i} className="text-[10px] text-muted-foreground font-mono">
                          {format(new Date(ts), 'h:mm:ss a')}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Metadata</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Version</span>
                <span className="font-mono">{session.version}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Project</span>
                <span className="font-medium truncate max-w-[120px]">{session.projectName}</span>
              </div>
              {session.gitBranch && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Branch</span>
                  <span className="font-mono truncate max-w-[120px]">{session.gitBranch}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* JSON Viewer Modal */}
      {selectedJson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="flex h-auto max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border p-4">
              <h3 className="text-sm font-semibold">Message JSON</h3>
              <button
                onClick={() => setSelectedJson(null)}
                className="rounded-md p-1 hover:bg-muted text-muted-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ScrollArea className="flex-1 min-h-0 overflow-y-scroll">
              <div className="p-4 text-xs">
                <SyntaxHighlighter
                  language="json"
                  style={oneDark}
                  customStyle={customCodeStyle}
                >
                  {JSON.stringify(selectedJson, null, 2)}
                </SyntaxHighlighter>
              </div>
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
}
