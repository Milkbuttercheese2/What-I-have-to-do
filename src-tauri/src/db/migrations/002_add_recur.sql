-- v2.3: recurring tasks. A single nullable JSON column on items holds the
-- recurrence rule ({"freq":"daily|weekly|monthly","dow":[..]}) or stays NULL
-- for one-off tasks. Kept as one column (not EAV) because it's a first-class
-- item property like done/staged, not a user-configurable custom field, and
-- the minimal rule set needs no per-path migration surgery.
ALTER TABLE items ADD COLUMN recur TEXT;
