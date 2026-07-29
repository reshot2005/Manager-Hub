-- Per-employee shift windows (IST). Default = standard 09:30–19:00

ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_start TEXT DEFAULT '09:30';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_end TEXT DEFAULT '19:00';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS late_after TEXT DEFAULT '09:30';

UPDATE employees SET shift_start = '09:30' WHERE shift_start IS NULL;
UPDATE employees SET shift_end = '19:00' WHERE shift_end IS NULL;
UPDATE employees SET late_after = COALESCE(late_after, shift_start, '09:30') WHERE late_after IS NULL;
