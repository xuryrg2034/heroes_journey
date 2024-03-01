using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class _Gem : MonoBehaviour, IDamageable
{
    [SerializeField] public bool isAggresive = false;
    [SerializeField] public bool canBeDestroyed = true;
    [SerializeField] public int type = 0;
    public int Health { get; private set; } = 1;
    public bool CanBeDamageable { get; private set; }
    public bool IsCollision { get; private set; }
    public bool IsDead { get; private set; } = false;
    public CellPosition PositionOnBoard { get; private set; }
    private bool _isClickable;

    private Action<_Gem> OnMouseClick;

    public void Initialze(int column, int row)
    {
        PositionOnBoard = new CellPosition(column, row);
    }

    public void TakeDamage(int damage)
    {
        var newHealth = Health - damage;

        if (newHealth > 0)
        {
            Health = newHealth;
        }
        else
        {
            Health = 0;
            IsDead = true;
        }
    }

    public void Dead()
    {
        // Очень дорого, стоит создать объектный пул
        Destroy(gameObject);
    }

    public void ChangePosition(Vector3 position)
    {
        transform.position = position;
    }

    public void EnableSelection(Action<_Gem> callback)
    {
        _isClickable = true;
        OnMouseClick += callback;
    }

    public void DisableSelection()
    {
        _isClickable = false;
        OnMouseClick = null;
    }

    private void OnMouseUpAsButton()
    {
        if (_isClickable)
        {
            OnMouseClick?.Invoke(this);
        }
    }

    
}
