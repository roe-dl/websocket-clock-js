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
        conf={iso_date:false,CET:{}};
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
      webSocketClock('uhr.ptb.de/time',conf); 
      }
    </script>

<div style="width:400px;justify-content:center">
'''
END_HTML = '''  </body>

</html>
'''

START_SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="00 0 200 200">
  <g font-family="sans-serif">
'''
END_SVG = '''  </g>
</svg>
'''
CLOCK_BACKGROUND = '    <circle id="ptbFaceBackground"cx="50%" cy="50%" r="50%"" fill="lightgray" data-fill-connected="#eaeaea" data-fill-disconnected="#ffb2b2"/>'
CLOCK_MIN = '    <line x1="%.6f%%" y1="%.6f%%" x2="%.6f%%" y2="%.6f%%" stroke="#404040" stroke-width="%s"/>'
CLOCK_AXIS = '    <circle cx="50%" cy="50%" r="5" fill="black" />'
HOUR_HAND = '''    <!-- hour hand -->
    <g id="ptbHourHand" transform="rotate(0,50%,50%)">
      <line x1="50%" y1="50%" x2="50%" y2="20%" stroke="black" stroke-width="7" />
    </g>'''
MINUTE_HAND = '''    <!-- minute hand -->
    <g id="ptbMinuteHand" transform="rotate(0,50%,50%)">
      <line x1="50%" y1="50%" x2="50%" y2="9%" stroke="black" stroke-width="5" />
    </g>'''
SECOND_HAND = '''    <!-- second hand -->
    <g id="ptbSecondHand" transform="rotate(0,50%,50%)">
      <line x1="50%" y1="50%" x2="50%" y2="5%" stroke="red" stroke-width="2" />
    </g>'''
CLOCK_DIGITAL = '''    <!-- digital -->
    <g id="ptbSwitchClock" text-anchor="middle"  letter-spacing="-0.2" font-size="8px" style="fill:#404040;stroke:none;cursor:pointer;">
     <text x="50%" y="24.5%" id="ptbDate"></text>
     <text x="50%" y="32%" id="ptbTime" font-size="16px" font-weight="bold"></text>
     <text x="50%" y="37%" id="ptbLocalTimezone"></text>
    </g>
 '''

def create_svg():
    print(START_SVG)
    print(CLOCK_BACKGROUND)
    print(CLOCK_AXIS)
    for i in range(0,60):
        a = i/30*math.pi
        if (i%5)==0:
            # hour
            l = 11
            b = 5
        else:
            # minute
            l = 5
            b = 3
        print(CLOCK_MIN % (50+(50-l)*math.cos(a),50+(50-l)*math.sin(a),50+50*math.cos(a),50+50*math.sin(a),b))
    print(CLOCK_DIGITAL)
    print('''    <text id="ptbNotice" x="50%" y="69.5%" text-anchor="middle" font-weight="bold" font-size="9px" fill="black"></text>''')
    print('''    <!-- deviation -->
    <g id="ptbTabDeviation" class="ptbAct" style="cursor:pointer;" aria-labelledby="ptbDeviationTitle" role="button" tabindex="2"><title id="ptbDeviationTitle">Abweichung der lokalen Geräte-Uhr anzeigen</title>
     <text id="ptbLinkDeviation" text-anchor="middle" x="50%" y="150" style="display:none;fill:#404040;stroke:none;font-weight:bold;font-size:14px;">&Delta;t</text>
     <g id="ptbDeviation" text-anchor="middle" letter-spacing="-0.2" style="display:none;fill:#404040;stroke:none;">
      <text x="50%" y="73%" font-size="9px">Die lokale Uhr geht
       <tspan x="50%" y="77.5%" id="ptbOffset"/> <tspan id="ptbAccuracy" dx="3" font-size="8px"/>
      </text>
     </g>
    </g>
''')
    print(HOUR_HAND)
    print(MINUTE_HAND)
    print(SECOND_HAND)
    print(END_SVG)

def create_html():
    print(START_HTML)
    create_svg()
    print(END_HTML)
        
create_html()
