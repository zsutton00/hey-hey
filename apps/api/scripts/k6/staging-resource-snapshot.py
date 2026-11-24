"""Host /proc and cgroup reads; no processes launched inside measured containers."""
import json
import os
from pathlib import Path
import subprocess
import time


ENVIRONMENT = os.environ.get('API_DIAGNOSTIC_ENVIRONMENT', 'staging')
if ENVIRONMENT not in ('staging', 'production'):
    raise RuntimeError('Invalid diagnostic environment')
PROJECT = 'hey-hey' if ENVIRONMENT == 'production' else 'hey-hey-staging'


def counters(path):
    return {key: int(value) for key, value in
            (line.split() for line in path.read_text().splitlines())}


def snapshot(path):
    started = time.time_ns()
    result = {'identity': str(path), 'startedAtNs': str(started),
              'cpu': counters(path / 'cpu.stat'),
              'cpuMax': (path / 'cpu.max').read_text().strip(),
              'memoryCurrent': int((path / 'memory.current').read_text()),
              'memoryMax': (path / 'memory.max').read_text().strip(),
              'memoryEvents': counters(path / 'memory.events')}
    processes = []
    for pid in (path / 'cgroup.procs').read_text().split():
        try:
            stat = Path('/proc', pid, 'stat').read_text()
            fields = stat[stat.rindex(')') + 2:].split()
            processes.append({'pid': int(pid), 'startTicks': int(fields[19]),
                              'cpuTicks': int(fields[11]) + int(fields[12]),
                              'command': stat[stat.index('(') + 1:stat.rindex(')')]})
        except (FileNotFoundError, ProcessLookupError):
            continue
    result.update(processes=processes, clockTicks=os.sysconf('SC_CLK_TCK'),
                  endedAtNs=str(time.time_ns()))
    return result


def main():
    ids = subprocess.check_output(['docker', 'ps', '--filter',
                                  'label=com.docker.compose.project=' + PROJECT,
                                  '--format', '{{.ID}}']).decode().split()
    records = json.loads(subprocess.check_output(['docker', 'inspect', *ids]))
    result = {'containers': {}, 'gaps': []}
    for record in records:
        name = record['Name'].lstrip('/')
        pid = record['State']['Pid']
        try:
            group = next(line[3:] for line in Path(f'/proc/{pid}/cgroup').read_text().splitlines()
                         if line.startswith('0::'))
            result['containers'][name] = snapshot(Path('/sys/fs/cgroup' + group))
        except (OSError, StopIteration):
            result['gaps'].append(f'{name}: cgroup/process counters unavailable')
    try:
        if ENVIRONMENT != 'staging':
            raise OSError('Production has no dedicated resource slice')
        slice_paths = {
            parent
            for container in result['containers'].values()
            for parent in Path(container['identity']).parents
            if parent.name == 'hey-hey-staging.slice'
        }
        if len(slice_paths) != 1:
            raise OSError(f'Expected one staging slice in container ancestry, found {len(slice_paths)}')
        result['slice'] = snapshot(slice_paths.pop())
    except OSError as error:
        result['gaps'].append(f'parent slice counters unavailable: {error}')
    result['capturedAtNs'] = str(time.time_ns())
    print(json.dumps(result))


if __name__ == '__main__':
    main()
