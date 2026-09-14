# Appends a content hash to asset URLs so browsers refetch them when they change.
#
# based on https://distresssignal.org/busting-css-cache-with-jekyll-md5-hash
# https://gist.github.com/BryanSchuetz/2ee8c115096d7dd98f294362f6a667db
module Jekyll
    module CacheBust
        class CacheDigester
            require 'digest/md5'

            attr_accessor :file_name, :directory, :extra_files

            def initialize(file_name:, directory: nil, extra_files: [])
                self.file_name = file_name
                self.directory = directory
                self.extra_files = extra_files
            end

            def digest!
                [file_name, '?', Digest::MD5.hexdigest(contents)].join
            end

            private

            # main.css is compiled from Sass, and at the point this filter runs the
            # compiled file does not exist yet, so the hash comes from the sources
            # it is built out of instead.
            def directory_contents
                paths = Dir[File.join(directory, '**', '*')].reject { |f| File.directory?(f) }
                # Sorted, because Dir order is filesystem-dependent and an unstable
                # order would produce a different hash on different machines for
                # identical content.
                (paths.sort + extra_files.select { |f| File.file?(f) })
                    .map { |f| File.binread(f) }
                    .join
            end

            def own_contents
                local_file_name = file_name.slice((file_name.index('assets/')..-1))
                File.binread(local_file_name)
            end

            def contents
                directory.nil? ? own_contents : directory_contents
            end
        end

        def bust_file_cache(file_name)
            CacheDigester.new(file_name: file_name).digest!
        end

        def bust_css_cache(file_name)
            # `_sass` and the entry point it is compiled from. This used to point at
            # `assets/_sass`, which does not exist, so the glob matched nothing and
            # every build hashed the empty string to the same value. The stylesheet
            # URL then never changed and browsers served a stale main.css forever.
            CacheDigester.new(
                file_name: file_name,
                directory: '_sass',
                extra_files: ['assets/css/main.scss']
            ).digest!
        end
    end
end

Liquid::Template.register_filter(Jekyll::CacheBust)
