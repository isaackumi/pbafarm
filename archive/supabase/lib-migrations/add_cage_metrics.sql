-- Add missing columns to cages table
ALTER TABLE cages
ADD COLUMN IF NOT EXISTS initial_weight DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS current_weight DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS growth_rate DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS initial_count INTEGER,
ADD COLUMN IF NOT EXISTS current_count INTEGER,
ADD COLUMN IF NOT EXISTS mortality_rate DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS last_maintenance_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS next_maintenance_date TIMESTAMP WITH TIME ZONE;

-- Add comments to explain the columns
COMMENT ON COLUMN cages.initial_weight IS 'Initial weight of fish in grams';
COMMENT ON COLUMN cages.current_weight IS 'Current weight of fish in grams';
COMMENT ON COLUMN cages.growth_rate IS 'Growth rate as a percentage';
COMMENT ON COLUMN cages.initial_count IS 'Initial number of fish stocked';
COMMENT ON COLUMN cages.current_count IS 'Current number of fish';
COMMENT ON COLUMN cages.mortality_rate IS 'Mortality rate as a percentage';
COMMENT ON COLUMN cages.last_maintenance_date IS 'Date of last maintenance';
COMMENT ON COLUMN cages.next_maintenance_date IS 'Date of next scheduled maintenance';

-- Create indexes for frequently queried columns
CREATE INDEX IF NOT EXISTS idx_cages_initial_weight ON cages(initial_weight);
CREATE INDEX IF NOT EXISTS idx_cages_current_weight ON cages(current_weight);
CREATE INDEX IF NOT EXISTS idx_cages_growth_rate ON cages(growth_rate);
CREATE INDEX IF NOT EXISTS idx_cages_last_maintenance_date ON cages(last_maintenance_date);
CREATE INDEX IF NOT EXISTS idx_cages_next_maintenance_date ON cages(next_maintenance_date); 