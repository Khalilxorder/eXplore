revoke all on public.private_chat_profiles from authenticated;
revoke all on public.private_conversations from authenticated;
revoke all on public.private_messages from authenticated;
revoke all on public.private_read_receipts from authenticated;

grant select, insert, update on public.private_chat_profiles to authenticated;
grant select, insert on public.private_conversations to authenticated;
grant select, insert on public.private_messages to authenticated;
grant select, insert, update on public.private_read_receipts to authenticated;
