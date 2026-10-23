#!/usr/bin/env node

const fs = require('fs');
const { Command } = require('commander');
const moment = require('moment');

class LogFilter {
  constructor() {
    this.logEntries = [];
    this.loggers = new Set();
    this.levels = new Set();
    this.dateRange = { start: null, end: null };
  }

  parseLogFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line) {
        i++;
        continue;
      }

      const logEntry = this.parseLogLine(line);
      if (logEntry) {
        // Check for continuation lines (lines that start with spaces)
        let fullContent = line;
        let j = i + 1;
        
        // Collect continuation lines
        while (j < lines.length) {
          const nextLine = lines[j];
          // If the next line starts with spaces (continuation) or is empty, include it
          if (nextLine.match(/^\s+/) || nextLine.trim() === '') {
            fullContent += '\n' + nextLine;
            j++;
          } else {
            // Next line is a new log entry, stop collecting
            break;
          }
        }
        
        // Update the log entry with full content
        logEntry.message = fullContent.substring(logEntry.originalLine.length).trim() || logEntry.message;
        logEntry.originalLine = fullContent;
        
        this.logEntries.push(logEntry);
        this.loggers.add(logEntry.logger);
        this.levels.add(logEntry.level);
        
        if (!this.dateRange.start || logEntry.timestamp < this.dateRange.start) {
          this.dateRange.start = logEntry.timestamp;
        }
        if (!this.dateRange.end || logEntry.timestamp > this.dateRange.end) {
          this.dateRange.end = logEntry.timestamp;
        }
        
        // Move to the next non-continuation line
        i = j;
      } else {
        i++;
      }
    }
  }

  parseLogLine(line) {
    // Try parsing NestJS format: [Nest] 36151  - 08/17/2025, 12:54:45 PM   DEBUG [FlexibleAuthGuard] ...
    const nestMatch = line.match(/^\[Nest\]\s+\d+\s+-\s+(\d{2}\/\d{2}\/\d{4},\s+\d{1,2}:\d{2}:\d{2}\s+[AP]M)\s+(DEBUG|INFO|LOG|WARN|ERROR)\s+\[([^\]]+)\]\s+(.*)$/);
    if (nestMatch) {
      const [, dateStr, level, logger, message] = nestMatch;
      return {
        timestamp: moment(dateStr, 'MM/DD/YYYY, h:mm:ss A').toDate(),
        level,
        logger,
        message: message.trim(),
        originalLine: line,
        format: 'nest'
      };
    }

    // Try parsing Workflow format: [conversationFlowWorkflow(...)] [DEBUG] [Handler:Initialize] ...
    const workflowMatch = line.match(/^\[conversationFlowWorkflow\([^\)]+\)\]\s+\[(DEBUG|INFO|LOG|WARN|ERROR)\]\s+\[([^\]]+)\]\s+(.*)$/);
    if (workflowMatch) {
      const [, level, handler, message] = workflowMatch;
      // For workflow logs, we'll use current time since they don't have timestamps
      // In a real implementation, you might want to use the previous timestamp or parse from context
      return {
        timestamp: new Date(), // Placeholder - workflow logs don't have embedded timestamps
        level,
        logger: `Workflow:${handler}`,
        message: message.trim(),
        originalLine: line,
        format: 'workflow'
      };
    }

    // Try parsing JSON format: {"timestamp":"2025-08-17T19:54:45.917Z","level":"info",...}
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        const json = JSON.parse(line);
        if (json.timestamp && json.level) {
          return {
            timestamp: new Date(json.timestamp),
            level: json.level.toUpperCase(),
            logger: json.service || json.context || 'JSON',
            message: json.message || JSON.stringify(json),
            originalLine: line,
            format: 'json'
          };
        }
      } catch (e) {
        // Not valid JSON, skip
      }
    }

    // If no format matches, treat as continuation of previous log or skip
    return null;
  }

  async promptUserForFilters() {
    const inquirer = (await import('inquirer')).default;
    
    console.log(`\nFound ${this.logEntries.length} log entries`);
    console.log(`Date range: ${moment(this.dateRange.start).format('MM/DD/YYYY HH:mm:ss')} to ${moment(this.dateRange.end).format('MM/DD/YYYY HH:mm:ss')}`);
    console.log(`Loggers found: ${Array.from(this.loggers).length}`);
    console.log(`Levels found: ${Array.from(this.levels).join(', ')}`);
    
    // Debug: Show all loggers and highlight InitiativeRefinementController
    console.log('\nAll detected loggers:');
    Array.from(this.loggers).sort().forEach(logger => {
      const count = this.logEntries.filter(e => e.logger === logger).length;
      const marker = logger === 'InitiativeRefinementController' ? ' <<<< THIS ONE' : '';
      console.log(`  ${logger}: ${count} entries${marker}`);
    });

    const questions = [
      {
        type: 'confirm',
        name: 'filterByDate',
        message: `Filter by date range? (Current: ${moment(this.dateRange.start).format('MM/DD/YYYY HH:mm')} - ${moment(this.dateRange.end).format('MM/DD/YYYY HH:mm')})`,
        default: false
      },
      {
        type: 'input',
        name: 'startDate',
        message: 'Start date (MM/DD/YYYY HH:mm):',
        when: (answers) => answers.filterByDate,
        default: moment(this.dateRange.start).format('MM/DD/YYYY HH:mm'),
        validate: (input) => {
          const date = moment(input, 'MM/DD/YYYY HH:mm');
          return date.isValid() || 'Please enter a valid date in MM/DD/YYYY HH:mm format';
        }
      },
      {
        type: 'input',
        name: 'endDate',
        message: 'End date (MM/DD/YYYY HH:mm):',
        when: (answers) => answers.filterByDate,
        default: moment(this.dateRange.end).format('MM/DD/YYYY HH:mm'),
        validate: (input) => {
          const date = moment(input, 'MM/DD/YYYY HH:mm');
          return date.isValid() || 'Please enter a valid date in MM/DD/YYYY HH:mm format';
        }
      },
      {
        type: 'checkbox',
        name: 'selectedLoggers',
        message: 'Select loggers to include:',
        choices: (() => {
          const choices = Array.from(this.loggers).sort().map(logger => {
            // Default these noisy loggers to unchecked
            const noisyLoggers = [
              'ApiKeyService',
              'ApiKeyStrategy', 
              'ArtifactDataValidators',
              'DomainEventPublisher',
              'EventRouter',
              'FlexibleAuthGuard',
              'JobEnqueringService',
              'OrganizationGuard',
              'OutboxPublisher',
              'OutboxStore',
              'RedisQueueService',
              'RedisService',
              'SignalDebouncingService',
              'WebsocketConnectionManager'
            ];
            
            const isChecked = !noisyLoggers.includes(logger);
            
            return {
              name: logger,
              value: logger,
              checked: isChecked
            };
          });
          
          // Debug: Show checkbox choices
          console.log('\nCheckbox choices (✓ = checked by default):');
          choices.forEach(choice => {
            const marker = choice.checked ? '✓' : '✗';
            const highlight = choice.name === 'InitiativeRefinementController' ? ' <<<< THIS ONE' : '';
            console.log(`  ${marker} ${choice.name}${highlight}`);
          });
          
          return choices;
        })(),
        validate: (choices) => choices.length > 0 || 'You must select at least one logger'
      },
      {
        type: 'checkbox',
        name: 'selectedLevels',
        message: 'Select log levels to include:',
        choices: Array.from(this.levels).sort().map(level => ({
          name: level,
          value: level,
          checked: true
        })),
        validate: (choices) => choices.length > 0 || 'You must select at least one log level'
      }
    ];

    return await inquirer.prompt(questions);
  }

  filterLogs(filters) {
    return this.logEntries.filter(entry => {
      // Filter by date range if specified
      if (filters.filterByDate) {
        const startDate = moment(filters.startDate, 'MM/DD/YYYY HH:mm').toDate();
        const endDate = moment(filters.endDate, 'MM/DD/YYYY HH:mm').toDate();
        if (entry.timestamp < startDate || entry.timestamp > endDate) {
          return false;
        }
      }

      // Filter by logger
      if (!filters.selectedLoggers.includes(entry.logger)) {
        return false;
      }

      // Filter by level
      if (!filters.selectedLevels.includes(entry.level)) {
        return false;
      }

      return true;
    });
  }

  cleanLogContent(content) {
    // Use regex to remove common verbose JS class patterns
    let cleaned = content;
    
    // Remove ZodObject and similar verbose class definitions
    cleaned = cleaned.replace(
      /(\s*)(\w+): (ZodObject|ZodNever|ZodString|ZodNumber|ZodArray) \{[\s\S]*?^\1\}/gm,
      '$1$2: $3 { [Verbose Class Definition Hidden] }'
    );
    
    // Remove function definitions with many methods (5+ lines of [Function: ...])
    cleaned = cleaned.replace(
      /(\s*)(\w+): (\w+) \{\s*\n((?:\s+\w+: \[Function:[^\]]+\][^\n]*\n){5,}[\s\S]*?)^\1\}/gm,
      '$1$2: $3 { [Class with Many Methods Hidden] }'
    );
    
    // Remove objects with spa, _def, parse, etc. (Zod-specific verbose patterns)
    cleaned = cleaned.replace(
      /(\s*)(\w+): (\w+) \{\s*\n[\s\S]*?(?:spa:|_def:|parse:|safeParse:)[\s\S]*?^\1\}/gm,
      '$1$2: $3 { [Verbose Schema Definition Hidden] }'
    );
    
    return cleaned;
  }

  writeFilteredLogs(filteredEntries, outputPath) {
    let output = filteredEntries.map(entry => entry.originalLine).join('\n');
    
    // Clean up verbose JS class definitions
    output = this.cleanLogContent(output);
    
    fs.writeFileSync(outputPath, output);
    console.log(`\nFiltered ${filteredEntries.length} log entries written to ${outputPath}`);
  }

  async run(inputFile) {
    try {
      console.log(`Reading log file: ${inputFile}`);
      this.parseLogFile(inputFile);

      if (this.logEntries.length === 0) {
        console.log('No log entries found in the file.');
        return;
      }

      const filters = await this.promptUserForFilters();
      const filteredEntries = this.filterLogs(filters);
      
      if (filteredEntries.length === 0) {
        console.log('No log entries match the selected filters.');
        return;
      }

      this.writeFilteredLogs(filteredEntries, 'filtered_logs.txt');
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  }
}

// Command line interface
const program = new Command();
program
  .name('filter-logs')
  .description('Filter log files based on time range, logger, and level')
  .argument('[file]', 'Log file to filter', 'logs.txt')
  .action(async (file) => {
    if (!fs.existsSync(file)) {
      console.error(`Error: File '${file}' not found.`);
      process.exit(1);
    }

    const logFilter = new LogFilter();
    await logFilter.run(file);
  });

program.parse();