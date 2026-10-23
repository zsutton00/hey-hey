"""Host /proc and cgroup reads; no processes launched inside measured containers."""
import json
import os
from pathlib import Path
import subprocess
import time


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
                                  'label=com.docker.compose.project=hey-hey-staging',
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
        group = subprocess.check_output(['systemctl', 'show', 'hey-hey-staging.slice',
                                         '--property=ControlGroup', '--value']).decode().strip()
        if not group or not group.endswith('/hey-hey-staging.slice'):
            raise OSError('Staging slice not resolved')
        result['slice'] = snapshot(Path('/sys/fs/cgroup' + group))
    except OSError:
        result['gaps'].append('parent slice counters unavailable')
    result['capturedAtNs'] = str(time.time_ns())
    print(json.dumps(result))


if __name__ == '__main__':
    main()
