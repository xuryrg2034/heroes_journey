using System.Collections;
using System.Collections.Generic;
using Unity.VisualScripting;
using UnityEngine;

public class _Bootstrap : MonoBehaviour
{
    [SerializeField] Player _playerPrefab;
    [SerializeField] _Cell _spawnerPrefab;

    public GridStore gridStore { get; private set; }
    public static _Bootstrap instance;
    public Fsm stateMachine;
    private Player player;
    void Start()
    {

        gridStore = new GridStore(_spawnerPrefab);
        player = Instantiate(_playerPrefab);
        stateMachine = new Fsm();


        stateMachine.AddState(new FsmInitializeState(stateMachine, gridStore, player));
        stateMachine.AddState(new FsmUserTurnState(stateMachine, gridStore, player));
        stateMachine.AddState(new FsmGamePlayState(stateMachine, gridStore, player));
        stateMachine.AddState(new FsmPlayerInteractState(stateMachine, gridStore, player));
        stateMachine.AddState(new FsmSpawnGemsState(stateMachine, gridStore, player));

        stateMachine.SetState<FsmInitializeState>();
    }

    void Update()
    {
        stateMachine.Update();
    }
    public void StartGame()
    {
        stateMachine.SetState<FsmGamePlayState>();
    }

    public void UserSelectionModeGame()
    {
        stateMachine.SetState<FsmUserTurnState>();
    }

}