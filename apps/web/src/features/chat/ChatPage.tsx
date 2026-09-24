/**
 * Chat: the conversation list, the thread, and the two ways to start a new one.
 *
 * **Not end-to-end encrypted**, and the UI says so rather than implying otherwise.
 *
 * Message bodies are rendered as text. There is no `dangerouslySetInnerHTML` anywhere in this
 * feature and there must not be: the server stores whatever was typed, so the only thing
 * standing between a pasted `<script>` and the reader is React escaping it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ChatMemberRole, ChatType, type ChatDTO, type ChatMessageDTO } from '@campusconnect/types';
import {
  chatApi,
  useAddChatMembersMutation,
  useCreateChatMutation,
  useDeleteMessageMutation,
  useEditMessageMutation,
  useGetChatQuery,
  useGetChatsQuery,
  useGetMessagesQuery,
  useLazySearchChatUsersQuery,
  useLeaveChatMutation,
  useMarkChatReadMutation,
  useMuteChatMutation,
  useSendMessageMutation,
} from '../../store/chatApi.js';
import { useAppDispatch, useAppSelector } from '../../store/index.js';
import { emitWithAck, joinChatRoom, leaveChatRoom, onSocketEvent } from '../../lib/socket.js';
import { PageHeader, SectionCard } from '../../components/ui/DataDisplay.js';
import { Alert, EmptyState, ErrorState, SkeletonRows } from '../../components/ui/Feedback.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { UPLOAD } from '@campusconnect/config';
import { AttachmentList, AttachmentPicker, useAttachmentUploads } from '../files/Attachments.js';

/** A message the user has sent that the server has not yet confirmed. */
interface PendingMessage {
  clientMessageId: string;
  body: string;
  attachmentCount: number;
  failed: boolean;
}

function newClientMessageId(): string {
  // url-safe and long enough for the server's schema; uniqueness only has to hold per sender.
  return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// --- The conversation list ------------------------------------------------------

function ChatList({
  chats,
  activeId,
  onSelect,
}: {
  chats: ChatDTO[];
  activeId: string | null;
  onSelect: (chatId: string) => void;
}): JSX.Element {
  return (
    <ul className="space-y-1" aria-label="Conversations">
      {chats.map((chat) => (
        <li key={chat.id}>
          <button
            type="button"
            onClick={() => onSelect(chat.id)}
            aria-current={chat.id === activeId ? 'true' : undefined}
            className={[
              'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition',
              chat.id === activeId
                ? 'bg-white/10 text-neutral-100'
                : 'text-neutral-300 hover:bg-white/5',
            ].join(' ')}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{chat.name || 'Conversation'}</span>
              <span className="block text-xs text-neutral-500">
                {chat.type === ChatType.DIRECT ? 'Direct message' : `${chat.memberCount} members`}
                {chat.muted && ' · muted'}
              </span>
            </span>
            {chat.unreadCount > 0 && (
              <span
                className="shrink-0 rounded-full bg-brand-500 px-2 py-0.5 text-xs font-semibold text-white"
                aria-label={`${chat.unreadCount} unread`}
              >
                {chat.unreadCount}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

// --- Starting a conversation ----------------------------------------------------

function NewChatDialog({ onCreated }: { onCreated: (chatId: string) => void }): JSX.Element {
  const [mode, setMode] = useState<'DIRECT' | 'GROUP' | null>(null);
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<Array<{ userId: string; fullName: string }>>([]);
  const [groupName, setGroupName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [search, results] = useLazySearchChatUsersQuery();
  const [createChat, { isLoading }] = useCreateChatMutation();

  // The server refuses a query shorter than two characters — there is no directory listing to
  // fall back on, by design.
  useEffect(() => {
    if (term.trim().length < 2) return;
    const timer = setTimeout(() => void search(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term, search]);

  const start = async (userId: string): Promise<void> => {
    try {
      const chat = await createChat({ type: ChatType.DIRECT, userId }).unwrap();
      onCreated(chat.id);
      setMode(null);
      setTerm('');
    } catch {
      setError('Could not start that conversation.');
    }
  };

  const createGroup = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (groupName.trim().length === 0) return;
    try {
      const chat = await createChat({
        type: ChatType.GROUP,
        name: groupName.trim(),
        memberIds: selected.map((user) => user.userId),
      }).unwrap();
      onCreated(chat.id);
      setMode(null);
      setGroupName('');
      setSelected([]);
    } catch {
      setError('Could not create that group.');
    }
  };

  if (!mode) {
    return (
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setMode('DIRECT')}>
          New message
        </Button>
        <Button variant="secondary" onClick={() => setMode('GROUP')}>
          New group
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-white/10 p-3">
      {error && <Alert tone="error">{error}</Alert>}
      {mode === 'GROUP' && (
        <Input
          label="Group name"
          value={groupName}
          onChange={(event) => setGroupName(event.target.value)}
          maxLength={80}
        />
      )}
      <Input
        label="Find someone"
        hint="Search by name — at least two characters."
        value={term}
        onChange={(event) => setTerm(event.target.value)}
      />

      {results.isFetching && <SkeletonRows rows={2} />}
      {results.data?.length === 0 && term.trim().length >= 2 && (
        <p className="text-sm text-neutral-400">Nobody by that name.</p>
      )}

      <ul className="space-y-1">
        {results.data?.map((user) => (
          <li key={user.userId} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-neutral-200">{user.fullName}</span>
            {mode === 'DIRECT' ? (
              <Button variant="ghost" onClick={() => void start(user.userId)} disabled={isLoading}>
                Message
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={() =>
                  setSelected((current) =>
                    current.some((item) => item.userId === user.userId)
                      ? current
                      : [...current, user],
                  )
                }
              >
                Add
              </Button>
            )}
          </li>
        ))}
      </ul>

      {mode === 'GROUP' && (
        <form onSubmit={(event) => void createGroup(event)} className="space-y-2">
          <p className="text-xs text-neutral-400">
            {selected.length === 0
              ? 'No members added yet.'
              : selected.map((u) => u.fullName).join(', ')}
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={isLoading || groupName.trim().length === 0}>
              Create group
            </Button>
            <Button variant="ghost" onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === 'DIRECT' && (
        <Button variant="ghost" onClick={() => setMode(null)}>
          Cancel
        </Button>
      )}
    </div>
  );
}

// --- One message ----------------------------------------------------------------

function MessageRow({
  message,
  mine,
  canModerate,
  onEdit,
  onDelete,
}: {
  message: ChatMessageDTO;
  mine: boolean;
  canModerate: boolean;
  onEdit: (message: ChatMessageDTO) => void;
  onDelete: (message: ChatMessageDTO) => void;
}): JSX.Element {
  if (message.type === 'SYSTEM') {
    return <li className="py-1 text-center text-xs text-neutral-500">{message.body}</li>;
  }

  return (
    <li className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[min(38rem,80%)] rounded-2xl px-3.5 py-2 text-sm',
          mine ? 'bg-brand-500/20 text-neutral-100' : 'bg-white/5 text-neutral-200',
        ].join(' ')}
      >
        {!mine && (
          <p className="mb-0.5 text-xs font-medium text-neutral-400">
            {message.sender?.fullName ?? 'Unknown'}
          </p>
        )}

        {message.deleted ? (
          <p className="italic text-neutral-500">This message was deleted.</p>
        ) : (
          <>
            {/* Plain text, escaped by React. Never dangerouslySetInnerHTML. */}
            {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
            <AttachmentList attachments={message.attachments} />
          </>
        )}

        <p className="mt-1 flex items-center gap-2 text-[11px] text-neutral-500">
          <span>{timeOf(message.createdAt)}</span>
          {message.editedAt && <span>edited</span>}
          {!message.deleted && mine && (
            <>
              <button
                type="button"
                className="underline hover:text-neutral-300"
                onClick={() => onEdit(message)}
              >
                Edit
              </button>
              <button
                type="button"
                className="underline hover:text-neutral-300"
                onClick={() => onDelete(message)}
              >
                Delete
              </button>
            </>
          )}
          {!message.deleted && !mine && canModerate && (
            <button
              type="button"
              className="underline hover:text-neutral-300"
              onClick={() => onDelete(message)}
            >
              Remove
            </button>
          )}
        </p>
      </div>
    </li>
  );
}

// --- The thread ------------------------------------------------------------------

function Conversation({ chatId }: { chatId: string }): JSX.Element {
  const dispatch = useAppDispatch();
  const myUserId = useAppSelector((state) => state.auth.user?.id ?? '');
  const canModerate = useAppSelector((state) =>
    (state.auth.user?.permissions ?? []).includes('chat:moderate'),
  );

  const chat = useGetChatQuery(chatId);
  const messages = useGetMessagesQuery({ chatId });
  const [sendMessage] = useSendMessageMutation();
  const [editMessage] = useEditMessageMutation();
  const [deleteMessage] = useDeleteMessageMutation();
  const [markRead] = useMarkChatReadMutation();
  const [muteChat] = useMuteChatMutation();
  const [leaveChat] = useLeaveChatMutation();
  const [addMembers] = useAddChatMembersMutation();

  const [draft, setDraft] = useState('');
  const attachments = useAttachmentUploads(UPLOAD.CHAT_MAX_ATTACHMENTS);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [typingUsers, setTypingUsers] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /** Write a message into the cached page, so the socket and REST agree on one list. */
  const upsertMessage = useCallback(
    (message: ChatMessageDTO) => {
      dispatch(
        chatApi.util.updateQueryData('getMessages', { chatId }, (draftState) => {
          const index = draftState.items.findIndex((item) => item.id === message.id);
          if (index >= 0) draftState.items[index] = message;
          else draftState.items.unshift(message);
        }),
      );
    },
    [chatId, dispatch],
  );

  // Join this chat's room, and leave it when the thread closes or changes.
  useEffect(() => {
    joinChatRoom(chatId);
    return () => leaveChatRoom(chatId);
  }, [chatId]);

  useEffect(() => {
    const unsubscribers = [
      onSocketEvent<ChatMessageDTO>('message:new', (message) => {
        if (message.chatId !== chatId) return;
        upsertMessage(message);
        // The optimistic copy has served its purpose once the real one arrives.
        setPending((current) =>
          current.filter((item) => item.clientMessageId !== message.clientMessageId),
        );
      }),
      onSocketEvent<ChatMessageDTO>('message:updated', (message) => {
        if (message.chatId === chatId) upsertMessage(message);
      }),
      onSocketEvent<{ chatId: string; messageId: string }>('message:deleted', (payload) => {
        if (payload.chatId !== chatId) return;
        dispatch(
          chatApi.util.updateQueryData('getMessages', { chatId }, (draftState) => {
            const message = draftState.items.find((item) => item.id === payload.messageId);
            if (message) {
              message.deleted = true;
              message.body = null;
              message.attachments = [];
            }
          }),
        );
      }),
      onSocketEvent<{ chatId: string; userId: string; typing: boolean }>('typing', (payload) => {
        if (payload.chatId !== chatId || payload.userId === myUserId) return;
        setTypingUsers((current) => ({
          ...current,
          [payload.userId]: payload.typing ? Date.now() : 0,
        }));
      }),
    ];
    return () => unsubscribers.forEach((off) => off());
  }, [chatId, dispatch, myUserId, upsertMessage]);

  // Mark the newest message read whenever the thread is open and something arrives.
  const newestId = messages.data?.items[0]?.id;
  useEffect(() => {
    if (newestId) void markRead({ chatId, lastReadMessageId: newestId });
  }, [chatId, markRead, newestId]);

  const typingNames = useMemo(() => {
    const active = Object.entries(typingUsers)
      .filter(([, at]) => at > 0 && Date.now() - at < 5_000)
      .map(([userId]) => chat.data?.members.find((member) => member.userId === userId)?.fullName)
      .filter((name): name is string => Boolean(name));
    return active;
  }, [typingUsers, chat.data]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const body = draft.trim();
    const attachmentFileIds = attachments.readyIds;
    if ((body.length === 0 && attachmentFileIds.length === 0) || attachments.busy) return;

    const clientMessageId = newClientMessageId();
    setDraft('');
    attachments.reset();
    // Optimistic: shown immediately, keyed by the id the server will echo back.
    setPending((current) => [
      ...current,
      { clientMessageId, body, attachmentCount: attachmentFileIds.length, failed: false },
    ]);

    const ack = await emitWithAck<{ ok: boolean }>('message:send', {
      chatId,
      body,
      clientMessageId,
      attachmentFileIds,
    });
    if (ack?.ok) return;

    // The socket was down or did not answer. The REST call carries the SAME clientMessageId, so
    // if the socket send actually landed this does not create a second message.
    try {
      const message = await sendMessage({
        chatId,
        body,
        clientMessageId,
        attachmentFileIds,
      }).unwrap();
      upsertMessage(message);
      setPending((current) => current.filter((item) => item.clientMessageId !== clientMessageId));
    } catch {
      setPending((current) =>
        current.map((item) =>
          item.clientMessageId === clientMessageId ? { ...item, failed: true } : item,
        ),
      );
    }
  };

  const onEdit = (message: ChatMessageDTO): void => {
    const next = window.prompt('Edit message', message.body ?? '');
    if (next === null || next.trim().length === 0) return;
    void editMessage({ chatId, messageId: message.id, body: next.trim() })
      .unwrap()
      .then(upsertMessage)
      .catch(() => setNotice('That message can no longer be edited.'));
  };

  const onDelete = (message: ChatMessageDTO): void => {
    void deleteMessage({ chatId, messageId: message.id })
      .unwrap()
      .catch(() => setNotice('That message could not be deleted.'));
  };

  const loadOlder = (): void => {
    const cursor = messages.data?.nextCursor;
    if (cursor) void dispatch(chatApi.endpoints.getMessages.initiate({ chatId, before: cursor }));
  };

  if (messages.isLoading || chat.isLoading) return <SkeletonRows rows={6} />;
  if (messages.isError) {
    return (
      <ErrorState
        message="This conversation could not be loaded."
        onRetry={() => void messages.refetch()}
      />
    );
  }

  const items = messages.data?.items ?? [];

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div>
          <h2 className="text-base font-semibold text-neutral-100">{chat.data?.name}</h2>
          <p className="text-xs text-neutral-500">
            {chat.data?.type === ChatType.DIRECT
              ? 'Direct message'
              : `${chat.data?.members.length ?? 0} members`}
            {' · not end-to-end encrypted'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => void muteChat({ chatId, muted: !(chat.data?.muted ?? false) })}
          >
            {chat.data?.muted ? 'Unmute' : 'Mute'}
          </Button>
          {chat.data?.type === ChatType.GROUP && (
            <>
              {(chat.data.myRole === ChatMemberRole.OWNER ||
                chat.data.myRole === ChatMemberRole.ADMIN) && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    const userId = window.prompt('Add member by user id');
                    if (userId) void addMembers({ chatId, userIds: [userId] });
                  }}
                >
                  Add member
                </Button>
              )}
              <Button variant="ghost" onClick={() => void leaveChat(chatId)}>
                Leave
              </Button>
            </>
          )}
        </div>
      </header>

      {notice && <Alert tone="warning">{notice}</Alert>}

      <div ref={listRef} className="flex-1 overflow-y-auto py-4">
        {messages.data?.hasMore && (
          <div className="mb-3 text-center">
            <Button variant="ghost" onClick={loadOlder}>
              Load earlier messages
            </Button>
          </div>
        )}

        {items.length === 0 && pending.length === 0 && (
          <EmptyState title="No messages yet" description="Say something to get started." />
        )}

        {/* Newest first from the API; reversed here so the thread reads downwards. */}
        <ul className="flex flex-col gap-2">
          {[...items].reverse().map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              mine={message.sender?.userId === myUserId}
              canModerate={canModerate}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}

          {pending.map((item) => (
            <li key={item.clientMessageId} className="flex justify-end">
              <div className="max-w-[min(38rem,80%)] rounded-2xl bg-brand-500/10 px-3.5 py-2 text-sm text-neutral-300">
                <p className="whitespace-pre-wrap break-words">{item.body}</p>
                {item.attachmentCount > 0 && (
                  <p className="text-xs text-neutral-400">
                    {item.attachmentCount} attachment{item.attachmentCount === 1 ? '' : 's'}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-neutral-500">
                  {item.failed ? 'Not sent — check your connection' : 'Sending…'}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="h-5 text-xs text-neutral-500" aria-live="polite">
        {typingNames.length > 0 && `${typingNames.join(', ')} is typing…`}
      </p>

      <form
        onSubmit={(event) => void submit(event)}
        className="space-y-2 border-t border-white/10 pt-3"
      >
        <AttachmentPicker
          uploads={attachments.uploads}
          onAdd={attachments.add}
          onRemove={attachments.remove}
        />
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label="Message"
              value={draft}
              maxLength={4000}
              onChange={(event) => {
                setDraft(event.target.value);
                void emitWithAck('typing', { chatId, typing: event.target.value.length > 0 });
              }}
            />
          </div>
          <Button
            type="submit"
            disabled={
              attachments.busy || (draft.trim().length === 0 && attachments.readyIds.length === 0)
            }
          >
            {attachments.busy ? 'Uploading…' : 'Send'}
          </Button>
        </div>
      </form>
    </div>
  );
}

// --- The page ---------------------------------------------------------------------

export function ChatPage(): JSX.Element {
  const chats = useGetChatsQuery();
  const [activeId, setActiveId] = useState<string | null>(null);

  // Keep the list's unread badges honest while the user is elsewhere in the app.
  useEffect(
    () =>
      onSocketEvent<{ chatId: string }>('message:new', () => {
        void chats.refetch();
      }),
    [chats],
  );

  const active = activeId ?? chats.data?.[0]?.id ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Chat"
        subtitle="Messages are private to their members and stored on campus servers. Not end-to-end encrypted."
      />

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <SectionCard title="Conversations">
          <div className="space-y-3">
            <NewChatDialog onCreated={setActiveId} />
            {chats.isLoading && <SkeletonRows rows={4} />}
            {chats.isError && (
              <ErrorState
                message="Your conversations could not be loaded."
                onRetry={() => void chats.refetch()}
              />
            )}
            {chats.data?.length === 0 && (
              <EmptyState
                title="No conversations yet"
                description="Start one with someone in your college."
              />
            )}
            {chats.data && chats.data.length > 0 && (
              <ChatList chats={chats.data} activeId={active} onSelect={setActiveId} />
            )}
          </div>
        </SectionCard>

        <SectionCard title="Conversation">
          <div className="h-[32rem]">
            {active ? (
              <Conversation key={active} chatId={active} />
            ) : (
              <EmptyState
                title="Nothing selected"
                description="Pick a conversation from the list."
              />
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
