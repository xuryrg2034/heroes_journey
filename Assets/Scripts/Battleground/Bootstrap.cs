using System;
using System.Collections.Generic;
using UnityEngine;

public class Bootstrap : MonoBehaviour
{
    [SerializeField] private GridView _gridPrefab;
    public static Bootstrap instance;
    public Fsm StateMachine { get; private set; } = new();
    private Grid grid;
    private GridController gridController;
    private int[,] _gridTemplave;
    

    private void Awake()
    {
        _gridTemplave = new int[2, 3]
        {
            /*{10, 10, 10},*/
            {10, 0, 10},
            {10, 10, 10},
        };

        grid = new Grid(_gridTemplave, _gridPrefab);
    }
    private void Start()
    {
        StateMachine.AddState(new FsmBattlegroundInitialize(StateMachine, grid));
        StateMachine.SetState<FsmBattlegroundInitialize>();
    }

    private void Update()
    {
        StateMachine.Update();
    }
}