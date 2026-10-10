Pod::Spec.new do |s|
  s.name           = 'StarMotion'
  s.version        = '1.0.0'
  s.summary        = 'CoreMotion true-north attitude for Star Map'
  s.author         = 'Open Apps Studio'
  s.homepage       = 'https://github.com/Open-Apps-Studio'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'CoreMotion'
  s.source_files   = '**/*.swift'
end
