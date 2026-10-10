package org.loka.meshlab

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.*
import androidx.compose.material3.Text
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import org.loka.core.PartyCard

internal fun cardCategory(card:PartyCard)=if("dirty" in card.tags)"dirty" else if(card.alcohol || "drinking" in card.tags)"drinking" else "clean"
internal fun mascotArt(category:String)=when(category){"dirty"->R.drawable.loka_mascot_dirty;"drinking"->R.drawable.loka_mascot_drinking;else->R.drawable.loka_mascot_clean}
internal fun cardArt(category:String)=when(category){"dirty"->R.drawable.loka_card_dirty;"drinking"->R.drawable.loka_card_drinking;else->R.drawable.loka_card_clean}

/** Shared artwork and bounds for dealing, swiping, and the revealed card. */
@Composable internal fun CardArtwork(category:String,height:Dp) {
    Image(painterResource(cardArt(category)),null,Modifier.fillMaxWidth().height(height),contentScale=ContentScale.FillBounds)
}

/** Original bundled artwork; the center is reserved for text, never covered by borders. */
@Composable internal fun CardGraphic(card:PartyCard,height:Dp,showText:Boolean=true,mode:String="group",interactive:Boolean=true) {
    Box(Modifier.fillMaxWidth().height(height),contentAlignment=Alignment.Center) {
        CardArtwork(cardCategory(card),height)
        if(showText)BoxWithConstraints(Modifier.fillMaxWidth(0.73f).height(height*0.59f),contentAlignment=Alignment.Center) {
            val measurer=rememberTextMeasurer();val density=LocalDensity.current
            val safeWidth=with(density){maxWidth.roundToPx()}.coerceAtLeast(1)
            val safeHeight=with(density){(maxHeight-20.dp).roundToPx()}.coerceAtLeast(1)
            val fontSize=(25 downTo 16).firstOrNull{size->
                val layout=measurer.measure(card.text,style=TextStyle(fontFamily=LokaDisplay.font,fontSize=size.sp,lineHeight=(size*1.2f).sp),constraints=Constraints(maxWidth=safeWidth))
                layout.size.height<=safeHeight
            } ?: 16
            Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState(),enabled=interactive),contentAlignment=Alignment.Center) {
                Text(card.text,fontFamily=LokaDisplay.font,fontSize=fontSize.sp,lineHeight=(fontSize*1.2f).sp,textAlign=TextAlign.Center,color=Color(0xFF240B30),modifier=Modifier.fillMaxWidth().padding(vertical=10.dp))
            }
        }
    }
}
