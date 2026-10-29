-- Settings (owner's walkthrough, 2026-10-28): a display name, a profile picture, the Dandy's three facts about the
-- person, Facebook sign-in, and more than one sign-in account on one Dandelist account.

-- What the person likes to be called; null until they set it.
alter table users add column if not exists name text check (name is null or char_length(name) between 1 and 60);
-- Their picture in the media store (sha256 of the bytes plus its extension), served at /media/<key>.
alter table users add column if not exists avatar_key text;
-- { "lines": ["...", "...", "..."], "generated_at": "2026-10-28T12:00:00.000Z" }, the latest facts the Dandy wrote.
alter table users add column if not exists facts jsonb;

-- Facebook joins Apple, Google and GitHub.
alter table user_identities drop constraint if exists user_identities_provider_check;
alter table user_identities add constraint user_identities_provider_check check (provider in ('google', 'github', 'apple', 'facebook'));

-- A finished provider sign-in can also add that identity to an account that is already signed in. Such a ticket
-- carries the identity ({ "provider", "subject", "email", "name" }) and is redeemed only by that account, with the
-- verifier of the app that started it. Sign-in never redeems one.
alter table oauth_tickets add column if not exists link jsonb;
