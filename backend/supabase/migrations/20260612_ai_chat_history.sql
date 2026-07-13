-- Create AI Chats and Messages tables
create table if not exists public.ai_chats (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    title text not null default 'New conversation',
    created_at timestamp with time zone not null default timezone('utc'::text, now()),
    updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

create table if not exists public.ai_messages (
    id uuid primary key default gen_random_uuid(),
    chat_id uuid not null references public.ai_chats(id) on delete cascade,
    role text not null check (role in ('user', 'assistant')),
    content text not null,
    created_at timestamp with time zone not null default timezone('utc'::text, now())
);

-- Enable RLS
alter table public.ai_chats enable row level security;
alter table public.ai_messages enable row level security;

-- Policies for ai_chats
create policy "Users can read their own AI chats"
    on public.ai_chats for select
    using (auth.uid() = user_id);

create policy "Users can insert their own AI chats"
    on public.ai_chats for insert
    with check (auth.uid() = user_id);

create policy "Users can update their own AI chats"
    on public.ai_chats for update
    using (auth.uid() = user_id);

create policy "Users can delete their own AI chats"
    on public.ai_chats for delete
    using (auth.uid() = user_id);

-- Policies for ai_messages
create policy "Users can read messages in their own AI chats"
    on public.ai_messages for select
    using (exists (
        select 1 from public.ai_chats
        where ai_chats.id = ai_messages.chat_id and ai_chats.user_id = auth.uid()
    ));

create policy "Users can insert messages in their own AI chats"
    on public.ai_messages for insert
    with check (exists (
        select 1 from public.ai_chats
        where ai_chats.id = ai_messages.chat_id and ai_chats.user_id = auth.uid()
    ));

create policy "Users can delete messages in their own AI chats"
    on public.ai_messages for delete
    using (exists (
        select 1 from public.ai_chats
        where ai_chats.id = ai_messages.chat_id and ai_chats.user_id = auth.uid()
    ));
