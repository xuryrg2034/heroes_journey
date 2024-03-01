using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.UIElements;

public class _Cell : MonoBehaviour
{
    [SerializeField] List<_Gem> AvailableGems;

    public _Gem Spawn(Transform parentPosition, int column, int row, Transform parent)
    {
        var gem = Instantiate(AvailableGems[Random.Range(0, AvailableGems.Count)], parentPosition.position, Quaternion.identity, parent);

        gem.Initialze(row, column);

        return gem;
    }
}