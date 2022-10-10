{
  'targets': [
    {
      'target_name': 'noslated',
      'type': 'none',
      'dependencies': [
        'copy_aworker_inspector_json',
      ],
    },
    {
      'target_name': 'copy_aworker_inspector_json',
      'type': 'none',
      'dependencies': [
        '<(noslate_aworker_dir)/src/inspector/aworker_inspector_protocol.gyp:aworker_inspector_protocol',
      ],
      'actions': [
        {
          'action_name': 'copy_aworker_inspector_json',
          'inputs': [
            '<(SHARED_INTERMEDIATE_DIR)/aworker-inspector-output-root/inspector_protocol.json',
          ],
          'outputs': [
            './src/lib/json/inspector_protocol.json',
          ],
          'action': [
            'cp',
            '<@(_inputs)',
            '<@(_outputs)',
          ],
        },
      ]
    },
  ]
}
