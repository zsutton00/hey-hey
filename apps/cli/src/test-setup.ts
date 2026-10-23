/**
 * Keep global test setup side-effect free. Individual suites construct their
 * own concrete owners so Vitest can replace process and network boundaries
 * before the modules under test are loaded.
 */
