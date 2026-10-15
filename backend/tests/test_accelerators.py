from types import SimpleNamespace as NS

import pytest

from backend.app import accelerators as a


@pytest.mark.parametrize('system,arch,gpus,extra,backend,index', [
    ('Windows', 'amd64', [], {}, 'cpu', 'cpu'),
    ('Darwin', 'arm64', [], {}, 'mps', 'simple'),
    ('Windows', 'amd64', [{'vendor': 'nvidia', 'name': 'GTX 1080 Ti', 'driver': '536.99', 'capability': '6.1'}], {}, 'cuda', 'cu126'),
    ('Windows', 'amd64', [{'vendor': 'nvidia', 'name': 'RTX 5090', 'driver': '576.52', 'capability': '12.0'}], {}, 'cuda', 'cu128'),
    ('Windows', 'amd64', [{'vendor': 'nvidia', 'name': 'GTX', 'driver': '470.0', 'capability': '6.1'}], {}, 'cpu', 'cpu'),
    ('Linux', 'x86_64', [{'vendor': 'amd', 'name': 'Radeon'}], {'rocm': '6.4.3'}, 'rocm', 'rocm6.4'),
    ('Windows', 'amd64', [{'vendor': 'amd', 'name': 'AMD Radeon RX 9070 XT'}], {'build': 26100}, 'rocm', 'simple'),
    ('Windows', 'amd64', [{'vendor': 'amd', 'name': 'AMD Radeon RX 9070 XT'}], {'build': 19045}, 'cpu', 'cpu'),
    ('Windows', 'amd64', [{'vendor': 'amd', 'name': 'AMD Radeon RX 580'}], {'build': 26100}, 'cpu', 'cpu'),
])
def test_installation_policy(system, arch, gpus, extra, backend, index):
    plan = a.installation_plan(dict(system=system, arch=arch, gpus=gpus, **extra))
    assert plan['backend'] == backend
    assert plan['index'].rstrip('/').endswith('/' + index)
    if backend == 'rocm' and system == 'Windows':
        assert len(plan['prerequisites']) == 4 and len(plan['packages']) == 2
        assert all(url.startswith('https://repo.radeon.com/') for url in plan['packages'])


def fake_torch(*, hip=None, cuda=False, mps=False):
    return NS(version=NS(hip=hip), cuda=NS(is_available=lambda: cuda, device_count=lambda: 2,
        get_device_name=lambda index: f'GPU {index}'), backends=NS(mps=NS(is_built=lambda: mps, is_available=lambda: mps)))


def test_rocm_uses_torch_cuda_namespace_and_validates_each_device(monkeypatch):
    calls = []
    def exercise(torch, device):
        calls.append(device)
        if device == 'cuda:0':
            raise RuntimeError('unsupported kernel')
    monkeypatch.setattr(a, '_exercise', exercise)
    devices = a.torch_devices(fake_torch(hip='6.4', cuda=True))
    assert calls == ['cuda:0', 'cuda:1']
    assert not devices[0]['available'] and 'unsupported kernel' in devices[0]['unavailable_reason']
    assert devices[1]['backend'] == 'rocm' and devices[1]['available']
    assert devices[-1]['id'] == 'cpu' and devices[-1]['available']


@pytest.mark.parametrize('failed', [False, True])
def test_mps_executes_work_before_becoming_selectable(monkeypatch, failed):
    def exercise(torch, device):
        assert device == 'mps'
        if failed:
            raise RuntimeError('MPS unavailable')
    monkeypatch.setattr(a, '_exercise', exercise)
    devices = a.torch_devices(fake_torch(mps=True))
    assert devices[0]['id'] == 'mps' and devices[0]['available'] is not failed
    assert devices[-1]['id'] == 'cpu'
