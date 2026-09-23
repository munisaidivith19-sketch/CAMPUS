/**
 * The chat API slice.
 *
 * REST covers everything a page load needs; the socket (lib/socket.ts) carries what happens
 * while you are watching. The two meet in the cache: socket events are written into these
 * endpoints' cached data rather than kept in a second store, so a reconnect that refetches from
 * REST converges on the same state instead of fighting it.
 */
import { createApi } from '@reduxjs/toolkit/query/react';
import type {
  ChatDTO,
  ChatDetailDTO,
  ChatMessageDTO,
  ChatType,
  CursorPageDTO,
} from '@campusconnect/types';
import { axiosBaseQuery } from './axiosBaseQuery.js';

export interface ChatUserOption {
  userId: string;
  fullName: string;
}

export const chatApi = createApi({
  reducerPath: 'chatApi',
  baseQuery: axiosBaseQuery(),
  tagTypes: ['Chats', 'Chat', 'Messages'],
  endpoints: (builder) => ({
    getChats: builder.query<ChatDTO[], void>({
      query: () => ({ url: '/chats' }),
      providesTags: ['Chats'],
    }),

    getChat: builder.query<ChatDetailDTO, string>({
      query: (id) => ({ url: `/chats/${id}` }),
      providesTags: ['Chat'],
    }),

    /**
     * One page of history, newest first.
     *
     * Pages are merged into a single cache entry keyed by chat id, so scrolling back does not
     * re-render the conversation from scratch and the cursor stays where the user left it.
     */
    getMessages: builder.query<CursorPageDTO<ChatMessageDTO>, { chatId: string; before?: string }>({
      query: ({ chatId, before }) => ({
        url: `/chats/${chatId}/messages`,
        params: { limit: 30, ...(before ? { before } : {}) },
      }),
      serializeQueryArgs: ({ queryArgs }) => queryArgs.chatId,
      merge: (existing, incoming, { arg }) => {
        if (!arg.before) return incoming;
        // An older page: append, skipping anything already held (a message can arrive over the
        // socket while a page is in flight).
        const known = new Set(existing.items.map((message) => message.id));
        existing.items.push(...incoming.items.filter((message) => !known.has(message.id)));
        existing.nextCursor = incoming.nextCursor;
        existing.hasMore = incoming.hasMore;
      },
      forceRefetch: ({ currentArg, previousArg }) =>
        currentArg?.before !== previousArg?.before || currentArg?.chatId !== previousArg?.chatId,
      providesTags: ['Messages'],
    }),

    createChat: builder.mutation<
      ChatDetailDTO,
      { type: typeof ChatType.DIRECT; userId: string } | { type: typeof ChatType.GROUP; name: string; memberIds: string[] }
    >({
      query: (body) => ({ url: '/chats', method: 'POST', data: body }),
      invalidatesTags: ['Chats'],
    }),

    /** The HTTP fallback. The socket path is preferred; this is what a dead socket falls back to. */
    sendMessage: builder.mutation<
      ChatMessageDTO,
      { chatId: string; body: string; clientMessageId: string }
    >({
      query: ({ chatId, ...data }) => ({
        url: `/chats/${chatId}/messages`,
        method: 'POST',
        data,
      }),
      invalidatesTags: ['Chats'],
    }),

    editMessage: builder.mutation<ChatMessageDTO, { chatId: string; messageId: string; body: string }>({
      query: ({ chatId, messageId, body }) => ({
        url: `/chats/${chatId}/messages/${messageId}`,
        method: 'PATCH',
        data: { body },
      }),
    }),

    deleteMessage: builder.mutation<{ status: string }, { chatId: string; messageId: string }>({
      query: ({ chatId, messageId }) => ({
        url: `/chats/${chatId}/messages/${messageId}`,
        method: 'DELETE',
      }),
    }),

    markChatRead: builder.mutation<{ status: string }, { chatId: string; lastReadMessageId: string }>({
      query: ({ chatId, lastReadMessageId }) => ({
        url: `/chats/${chatId}/read`,
        method: 'POST',
        data: { lastReadMessageId },
      }),
      invalidatesTags: ['Chats'],
    }),

    muteChat: builder.mutation<{ status: string }, { chatId: string; muted: boolean }>({
      query: ({ chatId, muted }) => ({ url: `/chats/${chatId}/mute`, method: 'PATCH', data: { muted } }),
      invalidatesTags: ['Chats'],
    }),

    addChatMembers: builder.mutation<ChatDetailDTO, { chatId: string; userIds: string[] }>({
      query: ({ chatId, userIds }) => ({
        url: `/chats/${chatId}/members`,
        method: 'POST',
        data: { userIds },
      }),
      invalidatesTags: ['Chat', 'Chats'],
    }),

    leaveChat: builder.mutation<{ status: string }, string>({
      query: (chatId) => ({ url: `/chats/${chatId}/leave`, method: 'POST' }),
      invalidatesTags: ['Chats'],
    }),

    /** The user picker. A search with a minimum length — the server refuses a blank query. */
    searchChatUsers: builder.query<ChatUserOption[], string>({
      query: (q) => ({ url: '/chats/users', params: { q } }),
    }),
  }),
});

export const {
  useGetChatsQuery,
  useGetChatQuery,
  useGetMessagesQuery,
  useCreateChatMutation,
  useSendMessageMutation,
  useEditMessageMutation,
  useDeleteMessageMutation,
  useMarkChatReadMutation,
  useMuteChatMutation,
  useAddChatMembersMutation,
  useLeaveChatMutation,
  useLazySearchChatUsersQuery,
} = chatApi;
