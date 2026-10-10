package org.loka.meshlab

import android.view.ViewGroup
import android.widget.NumberPicker
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.TextStyle
import java.util.Locale

/** Native inertial wheels. Clamp the day when changing month/year; never create an invalid date. */
@Composable internal fun BirthdayWheel(date:LocalDate,onChange:(LocalDate)->Unit,ink:Color) {
    val today=LocalDate.now()
    fun changed(year:Int=date.year,month:Int=date.monthValue,day:Int=date.dayOfMonth) {
        onChange(LocalDate.of(year,month,day.coerceAtMost(YearMonth.of(year,month).lengthOfMonth())).coerceAtMost(today))
    }
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        @Composable fun Wheel(label:String,value:Int,min:Int,max:Int,labels:Array<String>?=null,change:(Int)->Unit) {
            Column(Modifier.weight(1f)) {
                Text(label,color=ink)
                AndroidView(factory={context->NumberPicker(context).apply{
                    descendantFocusability=ViewGroup.FOCUS_BLOCK_DESCENDANTS
                    contentDescription="Birth ${label.lowercase()}"
                    wrapSelectorWheel=false
                }},update={picker->
                    picker.setOnValueChangedListener(null)
                    picker.displayedValues=null;picker.minValue=min;picker.maxValue=max;picker.displayedValues=labels;picker.value=value
                    if(android.os.Build.VERSION.SDK_INT>=29){picker.textColor=ink.toArgb();picker.selectionDividerHeight=2}
                    picker.setOnValueChangedListener{_,_,selected->change(selected)}
                },modifier=Modifier.fillMaxWidth().height(180.dp))
            }
        }
        Wheel("Month",date.monthValue,1,12,(1..12).map{java.time.Month.of(it).getDisplayName(TextStyle.SHORT,Locale.getDefault())}.toTypedArray()){changed(month=it)}
        Wheel("Day",date.dayOfMonth,1,YearMonth.of(date.year,date.monthValue).lengthOfMonth()){changed(day=it)}
        Wheel("Year",date.year,today.year-120,today.year){changed(year=it)}
    }
}
