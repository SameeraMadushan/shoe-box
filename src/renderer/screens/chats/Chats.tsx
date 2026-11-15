import { useCallback, useEffect, useMemo, useState } from 'react';
import { ERROR_COPY } from '../../../shared/errors';
import type { ChatSummary, SearchHit } from '../../../shared/types';
import { count, initials, kindLabel, lastSuccess, listWhen, plural, shortDate, since, tint, whenAt } from '../../app/format';
import { useApp, useUi } from '../../app/store';
import { SearchIcon, Warning } from '../../components/Icons';
import { MessageList } from './MessageList';

function preview(chat: ChatSummary): string {
  const p = chat.preview;
  if (!p) return '';
  return (p.fromMe ? 'You: ' : '') + (p.text || kindLabel(p.kind));
}

function metaLine(chat: ChatSummary): string {
  const archived = `${count(chat.messageCount)} messages archived`;
  if (chat.isGroup) return ['Group', chat.memberCount ? plural(chat.memberCount, 'person', 'people') : null, archived].filter(Boolean).join(' · ');
  return chat.firstMessageAt ? `${archived} · since ${since(chat.firstMessageAt)}` : archived;
}

export function Chats() {
  const app = useApp();
  const setScreen = useUi((s) => s.setScreen);
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [version, setVersion] = useState(0);
  const [activeId, setActiveId] = useState<number | null>(app.settings.lastChatId);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Map<number, SearchHit> | null>(null);

  const load = useCallback(() => {
    void window.api.listChats().then((list) => {
      setChats(list);
      setVersion((v) => v + 1);
    });
  }, []);
  useEffect(() => {
    load();
    return window.api.on('archiveChanged', load);
  }, [load]);

  useEffect(() => {
    const q = query.trim();
    if (!q) return setHits(null);
    let stale = false;
    const timer = setTimeout(() => {
      void window.api.search(q).then((found) => {
        if (!stale) setHits(new Map(found.map((h) => [h.chatId, h])));
      });
    }, 150);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query, version]);

  const visible = useMemo(() => (hits ? (chats ?? []).filter((c) => hits.has(c.id)) : (chats ?? [])), [chats, hits]);
  const active = chats?.find((c) => c.id === activeId) ?? chats?.[0];

  function open(id: number) {
    setActiveId(id);
    void window.api.updateSettings({ lastChatId: id });
  }

  const last = app.history[0];
  const failed = last?.status === 'failed' ? last : null;
  const good = lastSuccess(app.history);

  return (
    <div className="chats">
      <section className="chatlist" aria-label="Chat list">
        <div className="chatlist-head">
          <h1>Chats</h1>
          <div className="search">
            <label htmlFor="search">
              <SearchIcon />
            </label>
            <input
              id="search"
              className="field"
              type="search"
              placeholder="Search chats and messages"
              aria-label="Search chats and messages"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="chatlist-items">
          {visible.map((chat) => {
            const matches = hits?.get(chat.id)?.messages.length ?? 0;
            return (
              <button key={chat.id} className="chatrow" aria-current={chat.id === active?.id} onClick={() => open(chat.id)}>
                <span className="avatar" aria-hidden="true" style={{ background: tint(chat.id) }}>
                  {initials(chat.name)}
                </span>
                <span className="grow col">
                  <span className="row between gap8">
                    <span className="strong ellipsis">{chat.name}</span>
                    <span className="meta muted">{listWhen(chat.lastMessageAt)}</span>
                  </span>
                  <span className="small muted ellipsis">{matches > 0 ? plural(matches, 'matching message', 'matching messages') : preview(chat)}</span>
                </span>
              </button>
            );
          })}
          {chats && hits && visible.length === 0 && <p className="empty">No chats or messages match your search.</p>}
          {chats && !hits && chats.length === 0 && <p className="empty">No chats in the archive yet.</p>}
        </div>
      </section>

      <section className="conv" aria-label="Conversation">
        {failed && (
          <div className="banner" role="alert">
            <Warning />
            <span className="grow">
              <strong>The last backup did not run.</strong> {ERROR_COPY[failed.errorCode ?? 'UNKNOWN'].sentence}{' '}
              {good ? `Chats here are current up to ${shortDate(good.startedAt)}.` : ''}
            </span>
            <button
              className="btn2"
              onClick={() => {
                setScreen('backup');
                void window.api.backupNow();
              }}
            >
              Retry now
            </button>
          </div>
        )}
        {active ? (
          <>
            <header className="conv-head">
              <span className="avatar sm" aria-hidden="true" style={{ background: tint(active.id) }}>
                {initials(active.name)}
              </span>
              <div className="col grow">
                <h2 className="ellipsis">{active.name}</h2>
                <span className="small muted">{metaLine(active)}</span>
              </div>
            </header>
            <MessageList key={`${active.id}:${version}`} chat={active} hit={hits?.get(active.id)} />
          </>
        ) : (
          <p className="empty">{chats ? 'Select a chat to read it.' : ''}</p>
        )}
        <footer className="conv-foot">Read-only archive · {good ? `last updated ${whenAt(good.finishedAt ?? good.startedAt)}` : 'no backup yet'}</footer>
      </section>
    </div>
  );
}
