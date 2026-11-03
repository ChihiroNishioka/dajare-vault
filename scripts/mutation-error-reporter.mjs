import { writeFileSync } from 'node:fs';

export default class MutationErrorReporter {
  stderr = [];

  onUserConsoleLog(log) {
    if (log.type !== 'stderr') return;
    this.stderr.push({
      content: log.content,
      origin: log.origin,
      taskId: log.taskId,
    });
  }

  onTestRunEnd(testModules, unhandledErrors) {
    const tests = testModules.flatMap((testModule) =>
      [...testModule.children.allTests()].map((test) => ({
        id: test.id,
        fullName: test.fullName,
        moduleId: testModule.moduleId,
      })),
    );
    const testsById = new Map(tests.map((test) => [test.id, test]));
    const stderr = this.stderr.map((log) => ({
      ...log,
      testName: testsById.get(log.taskId)?.fullName,
    }));
    const errors = unhandledErrors.map((error) => {
      const test = testsById.get(error.taskId);
      let serialized;
      try {
        serialized = JSON.parse(JSON.stringify(error));
      } catch {
        serialized = { message: String(error) };
      }
      const stack = typeof serialized.stack === 'string' ? serialized.stack : '';
      const testModule = testModules.find(
        (candidate) => candidate.moduleId === test?.moduleId || stack.includes(candidate.moduleId),
      );
      const failedTests = testModule
        ? [...testModule.children.allTests()].filter((candidate) => !candidate.ok())
        : [];
      return {
        ...serialized,
        moduleId: testModule?.moduleId,
        testName:
          test?.fullName ?? (failedTests.length === 1 ? failedTests[0].fullName : undefined),
      };
    });
    const outputFile = process.env.MUTATION_ERROR_REPORT_FILE;
    if (!outputFile) throw new Error('MUTATION_ERROR_REPORT_FILE が設定されていません');
    writeFileSync(outputFile, JSON.stringify({ stderr, unhandledErrors: errors, tests }), 'utf8');
  }
}
