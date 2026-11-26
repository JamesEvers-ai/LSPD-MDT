-- LSPD MDT v23: Academy API hardening, test categories, and record-type compatibility.

-- Academy tests use a category for Rookie/Detective/K9/SWAT/etc. classifications.
alter table public.academy_tests add column if not exists category text not null default 'Qualifikation';
create index if not exists academy_tests_category_idx on public.academy_tests(category, active, updated_at desc);

-- Keep old record terminology compatible while the UI uses IA / High Command.
update public.fib_records set type='ia', classification='Geschützt – Internal Affairs' where lower(type)='doc';
update public.fib_records set type='highcommand', classification='Streng vertraulich – High Command' where lower(type)='director';

notify pgrst, 'reload schema';
