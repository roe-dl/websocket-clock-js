#!/usr/bin/python3
# Create clock face
# Copyright (C) 2021 Johanna Roedenbeck

"""
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
"""

import math
import optparse

usage="""%prog --html [--server=URL] [--tz=TIMEZONE[,OFFSET]] [svg-options]
       %prog --svg [svg-options]"""
epilog=""" """

def main():
    # Create a command line parser:
    parser = optparse.OptionParser(usage=usage, epilog=epilog)
    # commands
    parser.add_option("--html", action="store_true",
                      help="create HTML output")
    parser.add_option("--svg", action="store_true",
                      help="create SVG output")
    # HTML options
    hgroup = optparse.OptionGroup(parser,"HTML Options")
    hgroup.add_option("--server", type=str, metavar="URL",
                      default="uhr.ptb.de/time",
                      help="time server to contact, default uhr.ptb.de/time")
    hgroup.add_option("--tz", type=str, metavar="TIMEZONE[,OFFSET]",
                      default="CET",
                      help="timezone to display if no timezone is set in URL, default CET")
    parser.add_option_group(hgroup)
    # SVG options
    sgroup = optparse.OptionGroup(parser,"SVG Options")
    sgroup.add_option("--scale", type=str, metavar="[h[,m]]",
                      default="hour,minute",
                      help="include hour and minute scale lines, default both")
    sgroup.add_option("--scale-color", dest='scalecolor', type=str, metavar="COLOR",
                      default="#404040",
                      help="color of the scale lines, default #404040")
    sgroup.add_option("--hand-color", dest='handcolor', type=str, metavar="COLOR",
                      default="#000000",
                      help="color of the hour and minute hands, default black")
    sgroup.add_option("--background-color", dest='backgroundcolor', type=str, metavar="INVALID,CONNECTED,DISCONNECTED",
                      default="#000000,#eaeaea,#ffb2b2",
                      help="color of the clock face background")
    parser.add_option_group(sgroup)
    # parse arguments
    (options, args) = parser.parse_args()
    # SVG options
    svg_options = {}
    for x in options.scale.split(','):
        if len(x)>0: svg_options[x[0]+'Scale'] = True
    svg_options['scaleColor'] = options.scalecolor
    svg_options['backgroundColor'] = options.backgroundcolor.split(',')
    svg_options['handColor'] = options.handcolor
    # start program
    if options.html:
        create_html(options.server,options.tz,svg_options)
    elif options.svg:
        create_svg(svg_options)
    else:
        print("createCockFace.py --help to show usage instructions")


START_HTML='''<!DOCTYPE html>
<html lang="de">

  <!--
    This page is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This page is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
  -->
  
  <!--
    You can open this page with the parameter tz=timezone to select
    the timezone you want to display. Available timezones are CET,
    UTC, LMT, GMST, LMST, and in case of new versions of webSocketClock.js
    even more.
    
    In case of LMT and LMST you can add the parameter longitude=value
    to set the longitude to display the time for.
  -->
  
  <head>
    <script src="webSocketClock.js"></script>
  </head>

  <body>
    <script type="text/javascript">
      // Get the URL variables. Source: https://stackoverflow.com/a/26744533/1177153
      function getURLvar(k) {
        var p = {};
        location.search.replace(/[?&]+([^=&]+)=([^&]*)/gi, function(s, k, v) {p[k] = v});
        return k ? p[k] : p;
      }

      window.onload = function() {
      let tz = getURLvar("tz")
      if (tz === undefined)
        conf={iso_date:false,%s:{%s}};
      else if (tz=='CET'||tz=='MEZ')
        conf={iso_date:false,CET:{}};
      else
        {
          conf={iso_date:true};
          conf[tz] = {};
        }
      let lon = getURLvar("longitude");
      if (lon !== undefined)
        {
          conf.longitude = parseFloat(lon);
        }
      webSocketClock("%s",conf); 
      }
    </script>

    <div style="width:100%%;display:flex">
      <div style="width:400px;margin:0 auto">
'''
END_HTML = '''      </div>
    </div>

  </body>

</html>
'''

START_SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="00 0 200 200">
  <g font-family="sans-serif">
'''
END_SVG = '''  </g>
</svg>
'''
CLOCK_BACKGROUND = '    <circle id="ptbFaceBackground" cx="50%%" cy="50%%" r="50%%"" fill="%s" data-fill-connected="%s" data-fill-disconnected="%s"/>'
CLOCK_MIN = '    <line x1="%.6f%%" y1="%.6f%%" x2="%.6f%%" y2="%.6f%%" stroke="%s" stroke-width="%s" />'
CLOCK_AXIS = '    <circle cx="50%%" cy="50%%" r="5" fill="%s" />'
HOUR_HAND = '''    <!-- hour hand - Stundenzeiger -->
    <g id="ptbHourHand" transform="rotate(0,50%%,50%%)">
      <line x1="50%%" y1="50%%" x2="50%%" y2="20%%" stroke="%s" stroke-width="7" stroke-linecap="round" />
    </g>'''
MINUTE_HAND = '''    <!-- minute hand - Minutenzeiger -->
    <g id="ptbMinuteHand" transform="rotate(0,50%%,50%%)">
      <line x1="50%%" y1="50%%" x2="50%%" y2="9%%" stroke="%s" stroke-width="5" stroke-linecap="round" />
    </g>'''
SECOND_HAND = '''    <!-- second hand - Sekundenzeiger -->
    <g id="ptbSecondHand" transform="rotate(0,50%,50%)">
      <line x1="50%" y1="50%" x2="50%" y2="5%" stroke="red" stroke-width="2" stroke-linecap="round" />
      <circle cx="50%" cy="50%" r="2" fill="red" />
    </g>'''
CLOCK_DIGITAL = '''    <!-- digital -->
    <g id="ptbSwitchClock" text-anchor="middle"  letter-spacing="-0.2" font-size="8px" style="fill:%s;stroke:none;cursor:pointer;">
     <text x="50%%" y="24.5%%" id="ptbDate"></text>
     <text x="50%%" y="32%%" id="ptbTime" font-size="16px" font-weight="bold"></text>
     <text x="50%%" y="37%%" id="ptbLocalTimezone"></text>
    </g>
 '''

def create_svg(svg_options):
    print(START_SVG)
    try:
        bc = svg_options['backgroundColor']
        bc[2]
    except Exception:
        bc = ['#000000','#eaeaea','#ffb2b2']
    try:
        hc = svg_options['handColor']
    except Exception:
        hc = '#000000'
    try:
        sc = svg_options['scaleColor']
    except Exception:
        sc = '#404040'
    print(CLOCK_BACKGROUND % (bc[0],bc[1],bc[2]))
    print(CLOCK_AXIS % hc)
    if ('hScale' in svg_options or 'mScale' in svg_options):
        for i in range(0,60):
            a = i/30*math.pi
            if (i%5)==0 and 'hScale' in svg_options:
                # hour
                l = 11 if 'mScale' in svg_options else 5
                b = 5
            elif 'mScale' in svg_options:
                # minute
                l = 5
                b = 3
            else:
                l = 0
                b = 0
            if (l>0 and b>0):
                print(CLOCK_MIN % (50+(50-l)*math.cos(a),50+(50-l)*math.sin(a),50+50*math.cos(a),50+50*math.sin(a),sc,b))
    print(CLOCK_DIGITAL % sc)
    print('''    <text id="ptbNotice" x="50%" y="69.5%" text-anchor="middle" font-weight="bold" font-size="9px" fill="black"></text>''')
    print('''    <!-- deviation -->
    <g id="ptbTabDeviation" class="ptbAct" style="cursor:pointer;" aria-labelledby="ptbDeviationTitle" role="button" tabindex="2"><title id="ptbDeviationTitle">Abweichung der lokalen Geräte-Uhr anzeigen</title>
     <text id="ptbLinkDeviation" text-anchor="middle" x="50%%" y="75%%" style="display:none;fill:%s;stroke:none;font-weight:bold;font-size:14px;">&Delta;t</text>
     <g id="ptbDeviation" text-anchor="middle" letter-spacing="-0.2" style="display:none;fill:%s;stroke:none;">
      <text x="50%%" y="73%%" font-size="9px">Die lokale Uhr geht
       <tspan x="50%%" y="77.5%%" id="ptbOffset"/> <tspan id="ptbAccuracy" dx="3" font-size="8px"/>
      </text>
     </g>
    </g>
''' % (sc,sc))
    print(HOUR_HAND % hc)
    print(MINUTE_HAND % hc)
    print(SECOND_HAND)
    print(END_SVG)

def create_html(server,tz,svg_options):
    tz = tz.split(',')
    if len(tz)>1:
        x = "offset:" + tz[1]
    else:
        x = ""
    print(START_HTML % (tz[0],x,server))
    create_svg(svg_options)
    print(END_HTML)

        
main()
