import '../src/lib/load-env';
import { assertSafeTestEnvironment } from './helpers/assert-safe-test-environment';

assertSafeTestEnvironment();

// Existing auction flow tests exercise the enabled implementation explicitly. Tests
// for the kill switch override this value and restore it after each case.
process.env.COLLECTTT_AUCTION_MODE = 'enabled';
