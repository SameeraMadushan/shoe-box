import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatSummary, MessageCursor, MessageRow, SearchHit } from '../../../shared/types';
import { clock, dayLabel, daysAgo, duration, kindLabel } from '../../app/format';
import { Pause, PhotoIcon, Play, PlayCircle } from '../../components/Icons';
import { Lightbox } from '../../components/Modal';

const mediaUrl = (id: number) => `archive-media://media/${id}`;
/** Distance from an edge (px) at which the next page is fetched. */
const EDGE = 600;

function Voice({ src, durationS }: { src: string; durationS: number | null }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const total = durationS || audio.current?.duration || 0;
  return (
    <div className="voice">
      <audio
        ref={audio}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPosition(0)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
      />
      <button
        className="play"
        aria-label={playing ? 'Pause voice note' : 'Play voice note'}
        onClick={() => (playing ? audio.current?.pause() : void audio.current?.play())}
      >
        {playing ? <Pause /> : <Play />}
      </button>
      <div className="progress" aria-hidden="true">
        <div style={{ width: `${total ? Math.min(100, (position / total) * 100) : 0}%` }} />
      </div>
      <span className="small text2">{duration(durationS)}</span>
    </div>
  );
}

function Video({ src, durationS }: { src: string; durationS: number | null }) {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  return (
    <div className={`video ${started ? 'playing' : ''}`}>
      {/* preload="metadata" shows the first frame as the poster. */}
      <video ref={video} src={src} preload="metadata" controls={started} />
      {!started && (
        <button
          className="play"
          aria-label={`Play video${durationS ? `, ${duration(durationS)}` : ''}`}
          onClick={() => {
            setStarted(true);
            void video.current?.play();
          }}
        >
          <PlayCircle />
          <span>{duration(durationS)}</span>
        </button>
      )}
    </div>
  );
}

function Media({ m, onOpenPhoto }: { m: MessageRow; onOpenPhoto(src: string): void }) {
  const media = m.media;
  if (!media) return null;
  if (!media.available) {
    return (
      <div className="placeholder" role="img" aria-label={`${kindLabel(m.kind)} not available`}>
        <PhotoIcon />
        <span>
          {kindLabel(m.kind)}
          {media.durationS ? ` · ${duration(media.durationS)}` : ''}
        </span>
        <span>Not available on this iPhone at backup time</span>
      </div>
    );
  }
  const src = mediaUrl(media.id);
  if (m.kind === 'image') {
    return (
      <button className="thumb" aria-label="Open photo" onClick={() => onOpenPhoto(src)}>
        <img src={src} alt="Photo" loading="lazy" />
      </button>
    );
  }
  if (m.kind === 'video') return <Video src={src} durationS={media.durationS} />;
  if (m.kind === 'voice' || m.kind === 'audio') return <Voice src={src} durationS={media.durationS} />;
  return (
    <span className="text2">
      {kindLabel(m.kind)} · {media.fileName ?? 'file'}
    </span>
  );
}

function Bubble({ m, group, hit, onOpenPhoto }: { m: MessageRow; group: boolean; hit: boolean; onOpenPhoto(src: string): void }) {
  return (
    <div className={`bubble-line ${m.fromMe ? 'out' : ''}`}>
      <div className={`bubble ${hit ? 'hit' : ''}`} data-testid="bubble" data-hit={hit || undefined}>
        {group && !m.fromMe && m.senderName && <span className="sender">{m.senderName}</span>}
        <Media m={m} onOpenPhoto={onOpenPhoto} />
        {m.text ? <span>{m.text}</span> : !m.media && <span className="muted">This kind of message is not shown in the archive</span>}
        <div className="bubble-foot">
          {m.deletedOnPhone && <span className="deleted-tag">Deleted on phone · kept here</span>}
          <span>{clock(m.sentAt)}</span>
        </div>
      </div>
    </div>
  );
}

/** Virtualised message list. Pages 200 messages at a time in both directions. */
export function MessageList({ chat, hit }: { chat: ChatSummary; hit: SearchHit | undefined }) {
  const [items, setItems] = useState<MessageRow[]>([]);
  const [photo, setPhoto] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const edges = useRef({ older: true, newer: false, loading: false });
  const pendingScroll = useRef<{ index: number; align: 'start' | 'center' | 'end' } | null>(null);

  const hitIds = useMemo(() => new Set(hit?.messages.map((m) => m.id)), [hit]);
  // Search results arrive newest first: the view jumps to the newest match.
  const target = hit?.messages[0];
  const targetId = target?.id;
  const targetAt = target?.sentAt;

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 72,
    overscan: 10,
    getItemKey: (i) => items[i]!.id,
  });

  // Opening a chat lands on the newest message, or on the newest search match.
  useEffect(() => {
    let stale = false;
    const cursor: MessageCursor = targetId !== undefined && targetAt !== undefined ? { at: 'around', sentAt: targetAt, id: targetId } : { at: 'newest' };
    void window.api.getMessages(chat.id, cursor).then((rows) => {
      if (stale) return;
      edges.current = { older: rows.length > 0, newer: cursor.at === 'around', loading: false };
      const index = cursor.at === 'around' ? rows.findIndex((r) => r.id === targetId) : rows.length - 1;
      pendingScroll.current = rows.length ? { index: Math.max(0, index), align: cursor.at === 'around' ? 'center' : 'end' } : null;
      setItems(rows);
    });
    return () => {
      stale = true;
    };
  }, [chat.id, targetId, targetAt]);

  useLayoutEffect(() => {
    const p = pendingScroll.current;
    if (!p || items.length === 0) return;
    pendingScroll.current = null;
    virtualizer.scrollToIndex(p.index, { align: p.align });
  }, [items, virtualizer]);

  const loadMore = useCallback(
    async (direction: 'before' | 'after') => {
      const edge = direction === 'before' ? items[0] : items.at(-1);
      if (!edge || edges.current.loading) return;
      edges.current.loading = true;
      const rows = await window.api.getMessages(chat.id, { at: direction, sentAt: edge.sentAt, id: edge.id });
      edges.current.loading = false;
      if (rows.length === 0) {
        if (direction === 'before') edges.current.older = false;
        else edges.current.newer = false;
        return;
      }
      if (direction === 'before') {
        // Keep the message at the top of the view in place after prepending.
        const first = virtualizer.getVirtualItems().find((v) => v.end > (scroller.current?.scrollTop ?? 0));
        pendingScroll.current = { index: rows.length + (first?.index ?? 0), align: 'start' };
        setItems((current) => [...rows, ...current]);
      } else {
        setItems((current) => [...current, ...rows]);
      }
    },
    [chat.id, items, virtualizer],
  );

  function onScroll() {
    const el = scroller.current;
    if (!el || pendingScroll.current) return;
    if (el.scrollTop < EDGE && edges.current.older) void loadMore('before');
    else if (el.scrollHeight - el.scrollTop - el.clientHeight < EDGE && edges.current.newer) void loadMore('after');
  }

  return (
    <div className="messages" ref={scroller} onScroll={onScroll} data-testid="messages">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((v) => {
          const m = items[v.index]!;
          const previous = items[v.index - 1];
          const newDay = !previous || daysAgo(previous.sentAt) !== daysAgo(m.sentAt);
          return (
            <div
              key={m.id}
              data-index={v.index}
              ref={virtualizer.measureElement}
              className="msg-row"
              style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${v.start}px)` }}
            >
              {newDay && <div className="day">{dayLabel(m.sentAt)}</div>}
              <Bubble m={m} group={chat.isGroup} hit={hitIds.has(m.id)} onOpenPhoto={setPhoto} />
            </div>
          );
        })}
      </div>
      {photo && <Lightbox src={photo} onClose={() => setPhoto(null)} />}
    </div>
  );
}
