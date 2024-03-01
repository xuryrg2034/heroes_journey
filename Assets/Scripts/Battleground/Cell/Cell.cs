using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class Cell : MonoBehaviour
{
    [SerializeField] private List<GemView> _gems;
    [SerializeField] private bool _isPlayerSpawn;

    public int Column { get; private set; }
    public int Row { get; private set; }

    public void Initialze(int column, int row)
    {
        Column = column;
        Row = row;

        ChangePosition();

        if (_isPlayerSpawn)
        {
            var player = GetPlayer();
            SpawnGem(player);
        }
        else
        {
            var gem = GetRandomPlayer();
            SpawnGem(gem);
        }
    }
    

    private void ChangePosition()
    {
        transform.position = transform.position + Vector3.down * Row + Vector3.right * Column;
    }

    private GemView GetPlayer()
    {
        var player = _gems.Find((item) => item.GetComponent<Player>());
        
        _gems.Remove(player);

        return player;
    }

    public void SpawnGem(GemView gem)
    {
        var gemObject = Instantiate(gem, transform);
        gemObject.Initialze(Column, Row);
    }

    private GemView GetRandomPlayer()
    {
        return _gems[UnityEngine.Random.Range(0, _gems.Count)];
    }
}

[Serializable]
public struct CellType
{
    public int type;
    public Cell prefab;
}
