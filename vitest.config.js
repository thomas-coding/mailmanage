module.exports = {
  test: {
    environment: 'node',
    globals: true,
    maxWorkers: 1,
    minWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 75,
        branches: 60,
      },
    },
  },
};
