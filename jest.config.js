/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/extensions/gpai-core/__tests__'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
  collectCoverageFrom: [
    'extensions/gpai-core/hooks/**/*.ts',
    'extensions/gpai-core/utils/**/*.ts',
    '!extensions/gpai-core/**/__tests__/**'
  ]
}
