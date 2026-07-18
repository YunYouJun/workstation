import antfu from '@antfu/eslint-config'

export default antfu({
  ignores: [
    'home/dot_apm/private_apm.lock.yaml',
  ],
})
