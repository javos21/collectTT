-- Listing attributes are JSONB, so the simplified form needs a data cleanup rather
-- than a table change. Existing listings keep their core details and get schema v2.
UPDATE listings
SET attributes = attributes - ARRAY['set', 'card_name', 'card_number', 'rarity', 'graded', 'grader', 'grade', 'foil', 'language'],
    attributes_version = 2
WHERE category = 'trading_card';

UPDATE listings
SET attributes = attributes - ARRAY['title', 'issue', 'year', 'variant', 'key_issue', 'graded', 'grader', 'grade'],
    attributes_version = 2
WHERE category = 'comic';

UPDATE listings
SET attributes = attributes - ARRAY['item_type', 'franchise', 'year', 'sealed'],
    attributes_version = 2
WHERE category = 'collectible';
