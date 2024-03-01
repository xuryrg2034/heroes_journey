using System.Collections;
using System.Collections.Generic;
using Unity.VisualScripting;
using UnityEngine;
using DG.Tweening;
using System;

public class Player: MonoBehaviour
{
    public float BaseRange { get; private set; } = 1.5f;
    public int Power { get; private set; } = 0;
    public CellPosition PositionOnBoard { get; private set; } = new(-1, 0);

    public void ChangePower(int power)
    {
        Power += power;
    }

    public void Move(Vector3 nextPosition, CellPosition nextCellPosition, Action OnCompleteMoveCallback)
    {
        transform.DOMove(nextPosition, 0.3f)
            .SetEase(Ease.Linear)
            .OnComplete(() => {
                ChangePositionOnBoard(nextCellPosition.Column, nextCellPosition.Row);
                OnCompleteMoveCallback();
            });
    }

    public void Interact(IDamageable gem)
    {
        gem.TakeDamage(1);
    }

    public void ChangePositionOnBoard(int column, int row)
    {
        PositionOnBoard = new CellPosition(column, row);
    }
}
