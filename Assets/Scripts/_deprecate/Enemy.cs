using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class Enemy : _Gem
{
    /*void OnTriggerEnter2D(Collider2D other)
    {
        Destroy(gameObject);

        SceneStore.instance.IncreaseCounter();
    }*/

    /*private void OnMouseUpAsButton()
    {
        var availableType = SceneStore.instance.gridStore.availableTypeForselection;
        var playerPower = SceneStore.instance.player.power;

        if ((Health - playerPower) > 0) return;

        if (type == availableType || availableType == 0)
        {
            SceneStore.instance.gridStore.SelectCell(transform.position);
            SceneStore.instance.gridStore.ChangeAvailableType(type);
        }
    }*/
}
